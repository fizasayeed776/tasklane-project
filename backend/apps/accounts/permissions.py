from rest_framework.permissions import BasePermission


class IsAuthenticatedAccountUser(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)
