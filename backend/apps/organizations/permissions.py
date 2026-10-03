from rest_framework.permissions import BasePermission

from .models import OrganizationMember
from .services import ensure_role


class OrganizationRolePermission(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, organization):
        action = getattr(view, "action", None)
        if action == "members":
            minimum_role = (
                OrganizationMember.Role.ADMIN
                if request.method == "POST"
                else OrganizationMember.Role.VIEWER
            )
        elif action == "member":
            minimum_role = OrganizationMember.Role.ADMIN
        elif action in {"retrieve", "projects"}:
            minimum_role = OrganizationMember.Role.VIEWER
        else:
            return True

        ensure_role(request.user, organization.id, minimum_role)
        return True
