from rest_framework.exceptions import ValidationError

from apps.organizations.models import OrganizationMember as M
from apps.organizations.services import ensure_role

from .models import Project


def create_project(user, data):
    data = dict(data)
    org_id = data.pop("organization_id", None)
    if not org_id:
        raise ValidationError({"organization_id": "This field is required."})
    ensure_role(user, org_id, M.Role.ADMIN)
    return Project.objects.create(
        organization_id=org_id,
        created_by=user,
        **data,
    )


def update_project(user, project, data):
    ensure_role(user, project.organization_id, M.Role.ADMIN)
    data = dict(data)
    data.pop("organization_id", None)
    for field, value in data.items():
        setattr(project, field, value)
    project.save()
    return project


def delete_project(user, project):
    ensure_role(user, project.organization_id, M.Role.ADMIN)
    project.delete()
