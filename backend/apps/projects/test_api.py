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
def project_world():
    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    member = User.objects.create_user("member@example.com", "StrongPass!234")
    viewer = User.objects.create_user("viewer@example.com", "StrongPass!234")
    outsider = User.objects.create_user("outsider@example.com", "StrongPass!234")
    org = create_organization(owner, "Acme")
    other_org = create_organization(outsider, "Other")
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
        "member": member,
        "viewer": viewer,
        "outsider": outsider,
        "org": org,
        "other_org": other_org,
        "first": first,
        "second": second,
        "foreign": foreign,
    }


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


def test_project_lists_never_include_projects_from_other_organizations(project_world):
    response = client_for(project_world["owner"]).get("/api/projects/")
    ids = {item["id"] for item in response.json()["results"]}
    assert ids == {project_world["first"].id, project_world["second"].id}
