import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import OrganizationMember
from apps.organizations.services import create_organization
from apps.projects.models import Project
from apps.tasks.models import Activity, Comment, Task


pytestmark = pytest.mark.django_db


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def project_world():
    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    admin = User.objects.create_user("admin@example.com", "StrongPass!234")
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    viewer = User.objects.create_user("viewer@example.com", "StrongPass!234")
    outsider = User.objects.create_user("outsider@example.com", "StrongPass!234")
    org = create_organization(owner, "Acme")
    other_org = create_organization(outsider, "Other")
    OrganizationMember.objects.create(
        organization=org, user=admin, role=OrganizationMember.Role.ADMIN
    )
    OrganizationMember.objects.create(
        organization=org, user=member, role=OrganizationMember.Role.MEMBER
    )
    OrganizationMember.objects.create(
        organization=org, user=viewer, role=OrganizationMember.Role.VIEWER
    )
    first = Project.objects.create(
        organization=org, name="Alpha", description="first project", created_by=owner
    )
    second = Project.objects.create(
        organization=org,
        name="Beta",
        description="second project",
        created_by=owner,
        status=Project.Status.ARCHIVED,
    )
    foreign = Project.objects.create(
        organization=other_org, name="Secret", created_by=outsider
    )
    return {
        "owner": owner,
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "outsider": outsider,
        "org": org,
        "other_org": other_org,
        "first": first,
        "second": second,
        "foreign": foreign,
    }


@pytest.mark.parametrize("role", ["OWNER", "ADMIN"])
def test_owner_and_admin_can_delete_project_and_cascade_related_data(
    project_world, role
):
    project = project_world["first"]
    other_project = project_world["second"]
    task = Task.objects.create(
        project=project, title="Delete me", created_by=project_world["owner"]
    )
    other_task = Task.objects.create(
        project=other_project, title="Keep me", created_by=project_world["owner"]
    )
    comment = Comment.objects.create(
        task=task, user=project_world["owner"], content="Delete this comment"
    )
    other_comment = Comment.objects.create(
        task=other_task, user=project_world["owner"], content="Keep this comment"
    )
    activity = Activity.objects.create(
        organization=project_world["org"],
        task=task,
        actor=project_world["owner"],
        verb="task_created",
        message="Delete this activity",
    )
    other_activity = Activity.objects.create(
        organization=project_world["org"],
        task=other_task,
        actor=project_world["owner"],
        verb="task_created",
        message="Keep this activity",
    )

    response = client_for(project_world[role.lower()]).delete(
        f"/api/projects/{project.id}/"
    )

    assert response.status_code == 204
    assert not Project.objects.filter(pk=project.id).exists()
    assert not Task.objects.filter(pk=task.id).exists()
    assert not Comment.objects.filter(pk=comment.id).exists()
    assert not Activity.objects.filter(pk=activity.id).exists()
    assert Project.objects.filter(pk=other_project.id).exists()
    assert Task.objects.filter(pk=other_task.id).exists()
    assert Comment.objects.filter(pk=other_comment.id).exists()
    assert Activity.objects.filter(pk=other_activity.id).exists()


@pytest.mark.parametrize("role", ["MEMBER", "VIEWER"])
def test_member_and_viewer_cannot_delete_project(project_world, role):
    project = project_world["first"]

    response = client_for(project_world[role.lower()]).delete(
        f"/api/projects/{project.id}/"
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PERMISSION_DENIED"
    assert Project.objects.filter(pk=project.id).exists()


def test_user_from_another_organization_cannot_delete_project(project_world):
    project = project_world["first"]

    response = client_for(project_world["outsider"]).delete(
        f"/api/projects/{project.id}/"
    )

    assert response.status_code == 404
    assert Project.objects.filter(pk=project.id).exists()


def test_project_delete_openapi_documents_success_and_error_responses():
    response = APIClient().get("/api/schema/?format=json")
    assert response.status_code == 200
    delete = response.json()["paths"]["/api/projects/{id}/"]["delete"]

    assert {"204", "401", "403", "404"} <= delete["responses"].keys()


def test_project_create_update_and_delete(project_world):
    client = client_for(project_world["owner"])
    response = client.post(
        "/api/projects/",
        {
            "name": "Gamma",
            "description": "created through API",
            "organization_id": project_world["org"].id,
            "created_by": project_world["outsider"].id,
            "organization": project_world["other_org"].id,
        },
        format="json",
    )
    assert response.status_code == 201
    created = response.json()
    assert created["organization"] == project_world["org"].id
    assert created["created_by"] == project_world["owner"].id

    response = client.patch(
        f"/api/projects/{created['id']}/",
        {
            "name": "Renamed Gamma",
            "status": Project.Status.ARCHIVED,
            "organization_id": project_world["other_org"].id,
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["organization"] == project_world["org"].id
    assert response.json()["name"] == "Renamed Gamma"

    response = client.delete(f"/api/projects/{created['id']}/")
    assert response.status_code == 204
    assert not Project.objects.filter(pk=created["id"]).exists()


def test_project_search_ordering_and_filters_are_applied_after_tenant_scope(
    project_world,
):
    client = client_for(project_world["owner"])
    response = client.get("/api/projects/?search=second&status=ARCHIVED")
    assert [project["id"] for project in response.json()["results"]] == [
        project_world["second"].id
    ]

    response = client.get("/api/projects/?ordering=name")
    assert [project["name"] for project in response.json()["results"]] == [
        "Alpha",
        "Beta",
    ]

    response = client.get(
        f"/api/projects/?organization={project_world['other_org'].id}"
    )
    assert response.json()["results"] == []
    response = client.get(
        "/api/projects/",
        HTTP_X_ORGANIZATION_ID=str(project_world["other_org"].id),
    )
    assert response.json()["results"] == []
    response = client.get("/api/projects/", HTTP_X_ORGANIZATION_ID="invalid")
    assert response.json()["results"] == []


def test_project_list_is_paginated_after_tenant_scoping(project_world):
    Project.objects.bulk_create(
        [
            Project(
                organization=project_world["org"],
                name=f"Project {index}",
                created_by=project_world["owner"],
            )
            for index in range(51)
        ]
    )

    response = client_for(project_world["owner"]).get("/api/projects/?page=2")

    assert response.status_code == 200
    assert response.json()["count"] == 53
    assert len(response.json()["results"]) == 3


def test_project_detail_and_mutations_hide_foreign_tenant_objects(project_world):
    client = client_for(project_world["owner"])
    foreign_id = project_world["foreign"].id
    assert client.get(f"/api/projects/{foreign_id}/").status_code == 404
    assert (
        client.patch(
            f"/api/projects/{foreign_id}/", {"name": "stolen"}, format="json"
        ).status_code
        == 404
    )
    assert client.delete(f"/api/projects/{foreign_id}/").status_code == 404
    project_world["foreign"].refresh_from_db()
    assert project_world["foreign"].name == "Secret"


def test_project_write_roles_and_cross_organization_create_are_enforced(project_world):
    missing_organization = client_for(project_world["owner"]).post(
        "/api/projects/", {"name": "No organization"}, format="json"
    )
    assert missing_organization.status_code == 400

    payload = {"name": "New", "organization_id": project_world["org"].id}
    assert (
        client_for(project_world["member"])
        .post("/api/projects/", payload, format="json")
        .status_code
        == 403
    )
    assert (
        client_for(project_world["viewer"])
        .post("/api/projects/", payload, format="json")
        .status_code
        == 403
    )

    payload["organization_id"] = project_world["other_org"].id
    response = client_for(project_world["owner"]).post(
        "/api/projects/", payload, format="json"
    )
    assert response.status_code == 403
    assert not Project.objects.filter(name="New").exists()


def test_members_can_list_but_cannot_edit_projects(project_world):
    client = client_for(project_world["member"])
    assert client.get("/api/projects/").status_code == 200
    response = client.patch(
        f"/api/projects/{project_world['first'].id}/",
        {"name": "Not allowed"},
        format="json",
    )
    assert response.status_code == 403
    project_world["first"].refresh_from_db()
    assert project_world["first"].name == "Alpha"
    assert (
        client.delete(f"/api/projects/{project_world['first'].id}/").status_code == 403
    )


@pytest.mark.parametrize("role", ["MEMBER", "VIEWER"])
def test_non_admin_cannot_create_update_or_delete_projects(project_world, role):
    user = project_world[role.lower()]
    client = client_for(user)

    assert (
        client.post(
            "/api/projects/",
            {"name": "Blocked", "organization_id": project_world["org"].id},
            format="json",
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/projects/{project_world['first'].id}/",
            {"name": "Blocked"},
            format="json",
        ).status_code
        == 403
    )
    assert (
        client.delete(f"/api/projects/{project_world['first'].id}/").status_code == 403
    )


def test_project_lists_never_include_projects_from_other_organizations(project_world):
    response = client_for(project_world["owner"]).get("/api/projects/")
    ids = {item["id"] for item in response.json()["results"]}
    assert ids == {project_world["first"].id, project_world["second"].id}
