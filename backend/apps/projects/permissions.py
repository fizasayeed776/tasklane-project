from rest_framework.permissions import BasePermission

from apps.organizations.models import OrganizationMember
from apps.organizations.services import ensure_role


class ProjectRolePermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if getattr(view, "action", None) == "create":
            organization_id = request.data.get("organization_id")
            if organization_id:
                ensure_role(
                    request.user, organization_id, OrganizationMember.Role.ADMIN
                )
        return True

    def has_object_permission(self, request, view, project):
        action = getattr(view, "action", None)
        minimum_role = (
            OrganizationMember.Role.ADMIN
            if action in {"update", "partial_update", "destroy"}
            else OrganizationMember.Role.VIEWER
        )
        ensure_role(request.user, project.organization_id, minimum_role)
        return True
