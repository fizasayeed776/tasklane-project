from rest_framework.permissions import IsAuthenticated


class NotificationPermission(IsAuthenticated):
    """Notifications are scoped to the authenticated user's active memberships."""
