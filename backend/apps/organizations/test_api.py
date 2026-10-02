import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import OrganizationMember
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
    assert response.status_code == 201
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


def test_invitation_requires_registered_account(org_world):
    response = client_for(org_world["owner"]).post(
        f"/api/organizations/{org_world['org'].id}/members/",
        {"email": "unknown@example.com", "role": OrganizationMember.Role.MEMBER},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["success"] is False


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
