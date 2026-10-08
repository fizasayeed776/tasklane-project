from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    inline_serializer,
)
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.organizations.models import OrganizationMember

from . import selectors, services
from .models import Notification
from .permissions import NotificationPermission
from .serializers import NotificationSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Notification.objects.none()
    serializer_class = NotificationSerializer
    permission_classes = [NotificationPermission]
    throttle_scope = "notifications"

    def get_queryset(self):
        notifications = selectors.notifications_for_user(self.request.user)
        if self.request.query_params.get("unread", "").lower() == "true":
            notifications = notifications.filter(read_at__isnull=True)
        return notifications

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "unread",
                bool,
                OpenApiParameter.QUERY,
                description="Return only unread notifications when true.",
            )
        ],
        responses={200: NotificationSerializer(many=True)},
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        responses={
            200: inline_serializer(
                name="NotificationUnreadCount",
                fields={"count": serializers.IntegerField()},
            ),
            401: OpenApiResponse(description="Authentication required."),
        }
    )
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = selectors.unread_notifications_for_user(request.user).count()
        return Response({"count": count})

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "organization",
                int,
                OpenApiParameter.QUERY,
                description="Optionally restrict the update to an organization you belong to.",
            )
        ],
        responses={
            200: inline_serializer(
                name="NotificationsMarkedRead",
                fields={"updated": serializers.IntegerField()},
            ),
            401: OpenApiResponse(description="Authentication required."),
            404: OpenApiResponse(description="Organization not found."),
        },
    )
    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        notifications = selectors.notifications_for_user(request.user)
        organization_id = request.query_params.get("organization")
        if organization_id is not None:
            membership = OrganizationMember.objects.filter(
                user=request.user, organization_id=organization_id
            )
            if not membership.exists():
                raise NotFound()
            notifications = notifications.filter(organization_id=organization_id)
        updated = services.mark_all_notifications_read(notifications)
        return Response({"updated": updated})

    @extend_schema(
        request=None,
        responses={
            200: NotificationSerializer,
            401: OpenApiResponse(description="Authentication required."),
            404: OpenApiResponse(description="Notification not found."),
        },
    )
    @action(detail=True, methods=["post"], url_path="read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification = services.mark_notification_read(notification)
        return Response(
            self.get_serializer(notification).data, status=status.HTTP_200_OK
        )
