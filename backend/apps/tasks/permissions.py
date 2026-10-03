from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from apps.organizations.models import OrganizationMember
from apps.organizations.services import ensure_role
from apps.projects.selectors import projects_for_user


class OrganizationContextPermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        return True


class TaskRolePermission(OrganizationContextPermission):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False

        if getattr(view, "action", None) == "create":
            project_id = request.data.get("project")
            project = projects_for_user(request.user).filter(pk=project_id).first()
            if project:
                ensure_role(
                    request.user,
                    project.organization_id,
                    OrganizationMember.Role.MEMBER,
                )
        return True

    def has_object_permission(self, request, view, obj):
        action = getattr(view, "action", None)
        if action == "comments":
            minimum_role = (
                OrganizationMember.Role.MEMBER
                if request.method == "POST"
                else OrganizationMember.Role.VIEWER
            )
            ensure_role(request.user, obj.project.organization_id, minimum_role)
            return True

        if action == "activity" or action == "retrieve":
            ensure_role(
                request.user,
                obj.project.organization_id,
                OrganizationMember.Role.VIEWER,
            )
            return True

        if action in {"update", "partial_update"}:
            role = ensure_role(
                request.user,
                obj.project.organization_id,
                OrganizationMember.Role.MEMBER,
            )
            if role == OrganizationMember.Role.MEMBER and request.user.id not in (
                obj.created_by_id,
                obj.assigned_to_id,
            ):
                raise PermissionDenied(
                    "Members can only update tasks they created or are assigned to."
                )
            return True

        if action == "destroy":
            ensure_role(
                request.user, obj.project.organization_id, OrganizationMember.Role.ADMIN
            )
        return True


class CommentRolePermission(OrganizationContextPermission):
    def has_object_permission(self, request, view, comment):
        if view.action == "partial_update":
            if comment.user_id != request.user.id:
                raise PermissionDenied("You can only edit your own comments.")
            return True

        if view.action == "destroy" and comment.user_id != request.user.id:
            ensure_role(
                request.user,
                comment.task.project.organization_id,
                OrganizationMember.Role.ADMIN,
            )
        return True
