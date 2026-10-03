from datetime import timedelta

import pytest
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import OrganizationMember, PendingInvitation
from apps.organizations.services import create_organization
from apps.projects.models import Project


pytestmark = pytest.mark.django_db


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def org_world():
    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    outsider = User.objects.create_user("outsider@example.com", "StrongPass!234")
    org = create_organization(owner, "Acme")
    other_org = create_organization(outsider, "Other")
    return {"owner": owner, "outsider": outsider, "org": org, "other_org": other_org}


def test_create_and_list_organizations_are_membership_scoped(org_world):
    owner_client = client_for(org_world["owner"])
    response = owner_client.post(
        "/api/organizations/",
        {"name": "New Team", "role": "OWNER", "owner": org_world["outsider"].id},
        format="json",
    )
    assert response.status_code == 201
    created = response.json()
    assert created["role"] == "OWNER"
    assert created["name"] == "New Team"
    assert created["id"] != org_world["org"].id

    listed = owner_client.get("/api/organizations/")
    assert {item["id"] for item in listed.json()} == {
        org_world["org"].id,
        created["id"],
    }
    outsider_list = client_for(org_world["outsider"]).get("/api/organizations/")
    assert {item["id"] for item in outsider_list.json()} == {org_world["other_org"].id}


def test_user_can_belong_to_and_switch_between_multiple_organizations(org_world):
    OrganizationMember.objects.create(
        organization=org_world["other_org"],
        user=org_world["owner"],
        role=OrganizationMember.Role.VIEWER,
    )
    Project.objects.create(
        organization=org_world["org"],
        name="First tenant",
        created_by=org_world["owner"],
    )
    Project.objects.create(
        organization=org_world["other_org"],
        name="Second tenant",
        created_by=org_world["outsider"],
    )
    client = client_for(org_world["owner"])

    organizations = client.get("/api/organizations/")
    assert {item["id"] for item in organizations.json()} == {
        org_world["org"].id,
        org_world["other_org"].id,
    }
    for organization, visible_project in (
        (org_world["org"], "First tenant"),
        (org_world["other_org"], "Second tenant"),
    ):
        projects = client.get(
            "/api/projects/",
            HTTP_X_ORGANIZATION_ID=str(organization.id),
        )
        assert [item["name"] for item in projects.json()["results"]] == [
            visible_project
        ]


def test_nonmember_cannot_retrieve_or_list_another_organizations_data(org_world):
    response = client_for(org_world["owner"]).get(
        f"/api/organizations/{org_world['other_org'].id}/"
    )
    assert response.status_code == 404
    assert response.json()["success"] is False

    response = client_for(org_world["owner"]).get(
        f"/api/organizations/{org_world['other_org'].id}/members/"
    )
    assert response.status_code == 404


def test_admin_can_invite_registered_user_but_cannot_grant_owner(org_world):
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    client = client_for(admin)

    response = client.post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": member.email, "role": OrganizationMember.Role.VIEWER},
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["email"] == member.email
    assert response.json()["role"] == OrganizationMember.Role.VIEWER
    assert response.json()["pending"] is False

    admin_member = User.objects.create_user("newadmin@example.com", "StrongPass!234")
    response = client.post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": admin_member.email, "role": OrganizationMember.Role.ADMIN},
        format="json",
    )
    assert response.status_code == 403

    response = client.post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": member.email, "role": OrganizationMember.Role.OWNER},
        format="json",
    )
    assert response.status_code == 400
    member.refresh_from_db()
    assert member.memberships.get(organization=org_world["org"]).role == "VIEWER"


def test_member_cannot_invite_or_elevate_existing_membership(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    client = client_for(org_world["owner"])
    response = client.post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": member.email, "role": OrganizationMember.Role.ADMIN},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "This user is already a member."
    member.refresh_from_db()
    assert member.memberships.get(organization=org_world["org"]).role == "MEMBER"

    response = client_for(member).post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": org_world["outsider"].email, "role": OrganizationMember.Role.MEMBER},
        format="json",
    )
    assert response.status_code == 403
    assert (
        not org_world["outsider"]
        .memberships.filter(organization=org_world["org"])
        .exists()
    )


def test_unregistered_invite_creates_pending_invitation(org_world):
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": "unknown@example.com", "role": OrganizationMember.Role.MEMBER},
        format="json",
    )
    assert response.status_code == 201
    assert response.json() == {
        "email": "unknown@example.com",
        "role": OrganizationMember.Role.MEMBER,
        "pending": True,
    }
    invitation = PendingInvitation.objects.get(
        organization=org_world["org"], email="unknown@example.com"
    )
    assert invitation.invited_by == org_world["owner"]
    assert invitation.expires_at > timezone.now()


def test_registered_owner_can_invite_admin(org_world):
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": admin.email, "role": OrganizationMember.Role.ADMIN},
        format="json",
    )
    assert response.status_code == 201
    assert admin.memberships.get(organization=org_world["org"]).role == "ADMIN"


def test_pending_invitation_email_is_sent_by_celery_task(org_world):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="invitee@example.com",
        role=OrganizationMember.Role.VIEWER,
        invited_by=org_world["owner"],
    )
    with override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    ):
        from apps.organizations.tasks import send_invitation_email

        send_invitation_email(invitation.id)

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["invitee@example.com"]
    assert f"/register?invite={invitation.token}" in mail.outbox[0].body


def test_expired_pending_invitation_is_not_emailed(org_world):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="expired@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=org_world["owner"],
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    with override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
    ):
        from apps.organizations.tasks import send_invitation_email

        send_invitation_email(invitation.id)

    assert mail.outbox == []


def test_registration_accepts_matching_pending_invitation(org_world):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="new-user@example.com",
        role=OrganizationMember.Role.VIEWER,
        invited_by=org_world["owner"],
    )
    response = APIClient().post(
        "/api/auth/register/",
        {
            "email": invitation.email,
            "password": "StrongPass!234",
            "invite": invitation.token,
        },
        format="json",
    )
    assert response.status_code == 201
    user = User.objects.get(email=invitation.email)
    assert user.memberships.get(organization=org_world["org"]).role == "VIEWER"
    invitation.refresh_from_db()
    assert invitation.accepted_at is not None


def test_registration_auto_accepts_invitation_without_token_for_matching_email(
    org_world,
):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="new-user@example.com",
        role=OrganizationMember.Role.VIEWER,
        invited_by=org_world["owner"],
    )
    response = APIClient().post(
        "/api/auth/register/",
        {"email": invitation.email, "password": "StrongPass!234"},
        format="json",
    )
    assert response.status_code == 201
    user = User.objects.get(email=invitation.email)
    assert user.memberships.get(organization=org_world["org"]).role == "VIEWER"
    invitation.refresh_from_db()
    assert invitation.accepted_at is not None


def test_login_accepts_matching_pending_invitations(org_world):
    invitee = User.objects.create_user("invitee@example.com", "StrongPass!234")
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email=invitee.email,
        role=OrganizationMember.Role.MEMBER,
        invited_by=org_world["owner"],
    )
    response = APIClient().post(
        "/api/auth/login/",
        {"email": invitee.email, "password": "StrongPass!234"},
        format="json",
    )
    assert response.status_code == 200
    assert invitee.memberships.get(organization=org_world["org"]).role == "MEMBER"
    invitation.refresh_from_db()
    assert invitation.accepted_at is not None


@pytest.mark.parametrize(
    ("accepted_at", "expires_at", "message"),
    [
        (None, timezone.now() - timedelta(seconds=1), "This invitation has expired."),
        (
            timezone.now(),
            timezone.now() + timedelta(days=1),
            "This invitation has already been used.",
        ),
    ],
)
def test_registration_rejects_expired_or_used_invitation_tokens(
    org_world, accepted_at, expires_at, message
):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="invitee@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=org_world["owner"],
        accepted_at=accepted_at,
        expires_at=expires_at,
    )
    response = APIClient().post(
        "/api/auth/register/",
        {
            "email": "invitee@example.com",
            "password": "StrongPass!234",
            "invite": invitation.token,
        },
        format="json",
    )
    assert response.status_code == 400
    assert message in response.json()["error"]["message"]
    assert not User.objects.filter(email="invitee@example.com").exists()


def test_registration_invitation_requires_matching_email(org_world):
    invitation = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="invited@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=org_world["owner"],
    )
    response = APIClient().post(
        "/api/auth/register/",
        {
            "email": "different@example.com",
            "password": "StrongPass!234",
            "invite": invitation.token,
        },
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["error"]["message"] == (
        "Use the email address that received this invitation."
    )
    assert not User.objects.filter(email="different@example.com").exists()


@pytest.mark.parametrize(
    "role", [OrganizationMember.Role.MEMBER, OrganizationMember.Role.VIEWER]
)
def test_member_and_viewer_cannot_invite(org_world, role):
    user = User.objects.create_user(f"{role.lower()}@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=user, role=role
    )
    response = client_for(user).post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": "new@example.com", "role": OrganizationMember.Role.VIEWER},
        format="json",
    )
    assert response.status_code == 403
    assert not PendingInvitation.objects.filter(
        organization=org_world["org"], email="new@example.com"
    ).exists()


@pytest.mark.parametrize(
    "role", [OrganizationMember.Role.MEMBER, OrganizationMember.Role.VIEWER]
)
def test_member_and_viewer_cannot_manage_organization_members(org_world, role):
    actor = User.objects.create_user(
        f"actor-{role.lower()}@example.com", "StrongPass!234"
    )
    target = User.objects.create_user(
        f"target-{role.lower()}@example.com", "StrongPass!234"
    )
    OrganizationMember.objects.create(
        organization=org_world["org"], user=actor, role=role
    )
    target_membership = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=target,
        role=OrganizationMember.Role.MEMBER,
    )
    client = client_for(actor)
    path = f"/api/organizations/{org_world['org'].id}/members/{target_membership.id}/"

    assert (
        client.patch(
            path, {"role": OrganizationMember.Role.VIEWER}, format="json"
        ).status_code
        == 403
    )
    assert client.delete(path).status_code == 403


def test_owner_can_change_roles_but_cannot_manage_owner_membership(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    second_owner = User.objects.create_user("owner2@example.com", "StrongPass!234")
    member_link = OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    admin_link = OrganizationMember.objects.create(
        organization=org_world["org"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    owner_link = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=second_owner,
        role=OrganizationMember.Role.OWNER,
    )
    client = client_for(org_world["owner"])
    path = f"/api/organizations/{org_world['org'].id}/members"

    response = client.patch(
        f"{path}/{member_link.id}/",
        {"role": OrganizationMember.Role.ADMIN},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["role"] == "ADMIN"
    response = client.patch(
        f"{path}/{admin_link.id}/",
        {"role": OrganizationMember.Role.MEMBER},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["role"] == "MEMBER"

    assert (
        client.patch(
            f"{path}/{member_link.id}/",
            {"role": OrganizationMember.Role.OWNER},
            format="json",
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"{path}/{owner_link.id}/",
            {"role": OrganizationMember.Role.VIEWER},
            format="json",
        ).status_code
        == 403
    )
    assert client.delete(f"{path}/{owner_link.id}/").status_code == 403
    assert (
        client.patch(
            f"{path}/{org_world['org'].memberships.get(user=org_world['owner']).id}/",
            {"role": OrganizationMember.Role.MEMBER},
            format="json",
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"{path}/{org_world['org'].memberships.get(user=org_world['owner']).id}/"
        ).status_code
        == 403
    )


def test_admin_can_manage_members_and_viewers_but_not_admins(org_world):
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    viewer = User.objects.create_user("viewer@example.com", "StrongPass!234")
    other_admin = User.objects.create_user("otheradmin@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    member_link = OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    viewer_link = OrganizationMember.objects.create(
        organization=org_world["org"], user=viewer, role=OrganizationMember.Role.VIEWER
    )
    admin_link = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=other_admin,
        role=OrganizationMember.Role.ADMIN,
    )
    client = client_for(admin)
    path = f"/api/organizations/{org_world['org'].id}/members"

    for link, role in (
        (member_link, OrganizationMember.Role.VIEWER),
        (viewer_link, OrganizationMember.Role.MEMBER),
    ):
        response = client.patch(f"{path}/{link.id}/", {"role": role}, format="json")
        assert response.status_code == 200
    assert (
        client.patch(
            f"{path}/{member_link.id}/",
            {"role": OrganizationMember.Role.ADMIN},
            format="json",
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{path}/{admin_link.id}/",
            {"role": OrganizationMember.Role.MEMBER},
            format="json",
        ).status_code
        == 403
    )
    assert client.delete(f"{path}/{admin_link.id}/").status_code == 403
    assert client.delete(f"{path}/{member_link.id}/").status_code == 204
    assert client.delete(f"{path}/{viewer_link.id}/").status_code == 204
    self_link = org_world["org"].memberships.get(user=admin)
    assert (
        client.patch(
            f"{path}/{self_link.id}/",
            {"role": OrganizationMember.Role.MEMBER},
            format="json",
        ).status_code
        == 403
    )
    assert client.delete(f"{path}/{self_link.id}/").status_code == 403


def test_member_endpoints_return_404_for_other_organizations_members(org_world):
    other_member = OrganizationMember.objects.get(
        organization=org_world["other_org"], user=org_world["outsider"]
    )
    path = f"/api/organizations/{org_world['org'].id}/members/{other_member.id}/"
    client = client_for(org_world["owner"])
    assert (
        client.patch(
            path, {"role": OrganizationMember.Role.VIEWER}, format="json"
        ).status_code
        == 404
    )
    assert client.delete(path).status_code == 404


def test_members_list_is_limited_to_requested_organization(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.VIEWER
    )
    response = client_for(org_world["owner"]).get(
        f"/api/organizations/{org_world['org'].id}/members/"
    )
    assert response.status_code == 200
    assert {item["email"] for item in response.json()} == {
        org_world["owner"].email,
        member.email,
    }


def test_projects_action_returns_only_the_requested_organization(org_world):
    project = Project.objects.create(
        organization=org_world["org"],
        name="Visible project",
        created_by=org_world["owner"],
    )
    Project.objects.create(
        organization=org_world["other_org"],
        name="Hidden project",
        created_by=org_world["outsider"],
    )
    response = client_for(org_world["owner"]).get(
        f"/api/organizations/{org_world['org'].id}/projects/"
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [project.id]


def test_openapi_documents_member_mutation_security_and_error_responses():
    response = APIClient().get("/api/schema/?format=json")
    assert response.status_code == 200
    schema = response.json()
    operations = schema["paths"]["/api/organizations/{id}/members/{member_id}/"]

    for method, expected_errors in (
        ("patch", {"400", "401", "403", "404", "405", "429"}),
        ("delete", {"401", "403", "404", "405", "429"}),
    ):
        operation = operations[method]
        assert any("jwtAuth" in security for security in operation["security"])
        assert expected_errors <= operation["responses"].keys()
        for status_code in expected_errors:
            error_schema = operation["responses"][status_code]["content"][
                "application/json"
            ]["schema"]
            assert error_schema["$ref"].endswith("/ApiError")

    patch = operations["patch"]
    assert any(
        parameter["name"] == "member_id"
        and parameter["in"] == "path"
        and parameter["schema"]["type"] == "integer"
        for parameter in patch["parameters"]
    )


# ─── Transfer ownership ───────────────────────────────────────────────────────


def test_transfer_ownership_succeeds_and_swaps_roles(org_world):
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    membership = OrganizationMember.objects.create(
        organization=org_world["org"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    org = org_world["org"]

    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org.id}/transfer-ownership/",
        {"member_id": membership.id},
        format="json",
    )

    assert response.status_code == 200
    # New owner is the former admin
    org.refresh_from_db()
    assert org.owner_id == admin.id
    membership.refresh_from_db()
    assert membership.role == OrganizationMember.Role.OWNER
    # Former owner demoted to ADMIN
    old_owner_membership = OrganizationMember.objects.get(
        organization=org, user=org_world["owner"]
    )
    assert old_owner_membership.role == OrganizationMember.Role.ADMIN


def test_transfer_ownership_writes_activity_entry(org_world):
    from apps.tasks.models import Activity

    member = User.objects.create_user("member@example.com", "StrongPass!234")
    membership = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=member,
        role=OrganizationMember.Role.MEMBER,
    )
    client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": membership.id},
        format="json",
    )
    entry = Activity.objects.filter(
        organization=org_world["org"], verb="ownership_transferred"
    ).first()
    assert entry is not None
    assert member.display_name in entry.message
    assert org_world["owner"].display_name in entry.message


def test_transfer_ownership_org_always_has_exactly_one_owner(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    membership = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=member,
        role=OrganizationMember.Role.MEMBER,
    )
    client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": membership.id},
        format="json",
    )
    owner_count = OrganizationMember.objects.filter(
        organization=org_world["org"], role=OrganizationMember.Role.OWNER
    ).count()
    assert owner_count == 1


@pytest.mark.parametrize("role", ["ADMIN", "MEMBER", "VIEWER"])
def test_non_owner_cannot_transfer_ownership(org_world, role):
    actor = User.objects.create_user(f"{role.lower()}@example.com", "StrongPass!234")
    target = User.objects.create_user("target@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=actor, role=role
    )
    target_membership = OrganizationMember.objects.create(
        organization=org_world["org"],
        user=target,
        role=OrganizationMember.Role.MEMBER,
    )

    response = client_for(actor).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": target_membership.id},
        format="json",
    )
    assert response.status_code == 403
    assert response.json()["success"] is False
    # Org owner unchanged
    org_world["org"].refresh_from_db()
    assert org_world["org"].owner_id == org_world["owner"].id


def test_transfer_ownership_to_cross_organization_member_returns_404(org_world):
    outsider_membership = OrganizationMember.objects.get(
        organization=org_world["other_org"], user=org_world["outsider"]
    )
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": outsider_membership.id},
        format="json",
    )
    assert response.status_code == 404
    assert response.json()["success"] is False


def test_transfer_ownership_to_self_returns_400(org_world):
    owner_membership = OrganizationMember.objects.get(
        organization=org_world["org"], user=org_world["owner"]
    )
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": owner_membership.id},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False


def test_transfer_ownership_nonmember_gets_404(org_world):
    response = client_for(org_world["outsider"]).post(
        f"/api/organizations/{org_world['org'].id}/transfer-ownership/",
        {"member_id": 1},
        format="json",
    )
    assert response.status_code == 404
    assert response.json()["success"] is False


# ─── Leave organization ───────────────────────────────────────────────────────


def test_member_can_leave_organization(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    response = client_for(member).post(
        f"/api/organizations/{org_world['org'].id}/leave/",
        format="json",
    )
    assert response.status_code == 204
    assert not OrganizationMember.objects.filter(
        organization=org_world["org"], user=member
    ).exists()


def test_viewer_can_leave_organization(org_world):
    viewer = User.objects.create_user("viewer@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=viewer, role=OrganizationMember.Role.VIEWER
    )
    response = client_for(viewer).post(
        f"/api/organizations/{org_world['org'].id}/leave/",
    )
    assert response.status_code == 204


def test_admin_can_leave_organization(org_world):
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    response = client_for(admin).post(
        f"/api/organizations/{org_world['org'].id}/leave/",
    )
    assert response.status_code == 204


def test_owner_cannot_leave_organization(org_world):
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/leave/",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
    assert "transfer ownership" in response.json()["error"]["message"].lower()
    # Owner membership still exists
    assert OrganizationMember.objects.filter(
        organization=org_world["org"], user=org_world["owner"]
    ).exists()


def test_leave_unassigns_tasks_in_organization(org_world):
    from apps.tasks.models import Task

    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    project = Project.objects.create(
        organization=org_world["org"], name="P", created_by=org_world["owner"]
    )
    task = Task.objects.create(
        project=project,
        title="My task",
        created_by=org_world["owner"],
        assigned_to=member,
    )
    # Task in a different org should be unaffected
    other_task = Task.objects.create(
        project=Project.objects.create(
            organization=org_world["other_org"],
            name="Other",
            created_by=org_world["outsider"],
        ),
        title="Other task",
        created_by=org_world["outsider"],
        assigned_to=None,
    )

    client_for(member).post(f"/api/organizations/{org_world['org'].id}/leave/")

    task.refresh_from_db()
    assert task.assigned_to is None
    other_task.refresh_from_db()
    assert other_task.assigned_to is None  # was already None


def test_leave_nonmember_org_returns_404(org_world):
    response = client_for(org_world["outsider"]).post(
        f"/api/organizations/{org_world['org'].id}/leave/",
    )
    assert response.status_code == 404


def test_org_always_has_one_owner_after_leave(org_world):
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=member, role=OrganizationMember.Role.MEMBER
    )
    client_for(member).post(f"/api/organizations/{org_world['org'].id}/leave/")
    owner_count = OrganizationMember.objects.filter(
        organization=org_world["org"], role=OrganizationMember.Role.OWNER
    ).count()
    assert owner_count == 1


# ─── Delete organization ──────────────────────────────────────────────────────


def test_owner_can_delete_organization_with_correct_name(org_world):
    org_id = org_world["org"].id
    response = client_for(org_world["owner"]).delete(
        f"/api/organizations/{org_id}/",
        {"name": org_world["org"].name},
        format="json",
    )
    assert response.status_code == 204
    from apps.organizations.models import Organization

    assert not Organization.objects.filter(pk=org_id).exists()


def test_delete_organization_cascades_all_data(org_world):
    from apps.tasks.models import Activity, Comment, Task

    project = Project.objects.create(
        organization=org_world["org"], name="P", created_by=org_world["owner"]
    )
    task = Task.objects.create(
        project=project, title="T", created_by=org_world["owner"]
    )
    comment = Comment.objects.create(task=task, user=org_world["owner"], content="C")
    activity = Activity.objects.create(
        organization=org_world["org"],
        task=task,
        actor=org_world["owner"],
        verb="task_created",
        message="created task",
    )
    pending = PendingInvitation.objects.create(
        organization=org_world["org"],
        email="pending@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=org_world["owner"],
    )

    client_for(org_world["owner"]).delete(
        f"/api/organizations/{org_world['org'].id}/",
        {"name": org_world["org"].name},
        format="json",
    )

    assert not Project.objects.filter(pk=project.id).exists()
    assert not Task.objects.filter(pk=task.id).exists()
    assert not Comment.objects.filter(pk=comment.id).exists()
    assert not Activity.objects.filter(pk=activity.id).exists()
    assert not PendingInvitation.objects.filter(pk=pending.id).exists()
    assert not OrganizationMember.objects.filter(
        organization_id=org_world["org"].id
    ).exists()


def test_delete_organization_wrong_name_returns_400(org_world):
    response = client_for(org_world["owner"]).delete(
        f"/api/organizations/{org_world['org'].id}/",
        {"name": "Wrong Name"},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
    assert "does not match" in response.json()["error"]["message"]
    # Org still exists
    from apps.organizations.models import Organization

    assert Organization.objects.filter(pk=org_world["org"].id).exists()


@pytest.mark.parametrize("role", ["ADMIN", "MEMBER", "VIEWER"])
def test_non_owner_cannot_delete_organization(org_world, role):
    actor = User.objects.create_user(f"{role.lower()}@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org_world["org"], user=actor, role=role
    )
    response = client_for(actor).delete(
        f"/api/organizations/{org_world['org'].id}/",
        {"name": org_world["org"].name},
        format="json",
    )
    assert response.status_code == 403
    assert response.json()["success"] is False
    from apps.organizations.models import Organization

    assert Organization.objects.filter(pk=org_world["org"].id).exists()


def test_delete_organization_nonmember_returns_404(org_world):
    response = client_for(org_world["outsider"]).delete(
        f"/api/organizations/{org_world['org'].id}/",
        {"name": org_world["org"].name},
        format="json",
    )
    assert response.status_code == 404
    assert response.json()["success"] is False


def test_delete_organization_missing_name_field_returns_400(org_world):
    response = client_for(org_world["owner"]).delete(
        f"/api/organizations/{org_world['org'].id}/",
        {},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False
