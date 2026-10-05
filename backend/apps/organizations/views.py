from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, extend_schema

from apps.projects.serializers import ProjectSerializer

from . import selectors, services
from .models import Organization, PendingInvitation
from .permissions import OrganizationRolePermission
from .serializers import (
    ApiErrorSerializer,
    DeleteOrganizationSerializer,
    InviteResultSerializer,
    InviteSerializer,
    LeaveOrganizationSerializer,
    MemberRoleSerializer,
    MemberSerializer,
    OrganizationSerializer,
    PendingInvitationSerializer,
    TransferOwnershipSerializer,
)


class OrganizationViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Organization.objects.none()
    serializer_class = OrganizationSerializer
    pagination_class = None
    permission_classes = [OrganizationRolePermission]

    def get_queryset(
        self,
    ):  # tenant boundary: only orgs the caller belongs to -> others are 404
        return selectors.orgs_for_user(self.request.user)

    def perform_create(self, serializer):
        serializer.instance = services.create_organization(
            self.request.user, serializer.validated_data["name"]
        )

    @extend_schema(
        methods=["GET"],
        responses={200: MemberSerializer(many=True)},
    )
    @extend_schema(
        methods=["POST"],
        request=InviteSerializer,
        responses={
            201: InviteResultSerializer,
            400: ApiErrorSerializer,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    @action(detail=True, methods=["get", "post"], filter_backends=[])
    def members(self, request, pk=None):
        org = self.get_object()
        if request.method == "POST":
            s = InviteSerializer(data=request.data)
            s.is_valid(raise_exception=True)
            member = services.invite_member(request.user, org, **s.validated_data)
            if isinstance(member, PendingInvitation):
                from django.conf import settings

                result = PendingInvitationSerializer(member).data
                result["pending"] = True
                result["invite_url"] = (
                    f"{settings.FRONTEND_URL}/register?invite={member.token}"
                )
                result["expires_at"] = member.expires_at
            else:
                result = MemberSerializer(member).data
                result["pending"] = False
            return Response(result, status=status.HTTP_201_CREATED)
        return Response(MemberSerializer(selectors.members_of(org), many=True).data)

    @extend_schema(
        methods=["PATCH"],
        parameters=[
            OpenApiParameter(
                "member_id",
                int,
                OpenApiParameter.PATH,
                description="Organization membership ID.",
            )
        ],
        request=MemberRoleSerializer,
        responses={
            200: MemberSerializer,
            400: ApiErrorSerializer,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    @extend_schema(
        methods=["DELETE"],
        parameters=[
            OpenApiParameter(
                "member_id",
                int,
                OpenApiParameter.PATH,
                description="Organization membership ID.",
            )
        ],
        responses={
            204: None,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"members/(?P<member_id>[^/.]+)",
        filter_backends=[],
    )
    def member(self, request, pk=None, member_id=None):
        org = self.get_object()
        member = selectors.member_in_organization(org, member_id)
        if request.method == "PATCH":
            serializer = MemberRoleSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            updated = services.change_member_role(
                request.user, org, member, serializer.validated_data["role"]
            )
            return Response(MemberSerializer(updated).data)
        services.remove_member(request.user, org, member)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={200: ProjectSerializer(many=True)})
    @action(detail=True, methods=["get"], filter_backends=[])
    def projects(self, request, pk=None):
        org = (
            self.get_object()
        )  # GET /api/organizations/2/projects/ by a non-member -> 404, no data
        return Response(ProjectSerializer(org.projects.all(), many=True).data)

    @extend_schema(
        methods=["POST"],
        summary="Transfer organization ownership",
        description=(
            "Only the current OWNER may call this. The target must be an existing "
            "member of the same organization. Previous owner becomes ADMIN."
        ),
        request=TransferOwnershipSerializer,
        responses={
            200: OrganizationSerializer,
            400: ApiErrorSerializer,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    @action(detail=True, methods=["post"], url_path="transfer-ownership")
    def transfer_ownership(self, request, pk=None):
        org = self.get_object()
        s = TransferOwnershipSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        target_member = selectors.member_in_organization(
            org, s.validated_data["member_id"]
        )
        updated_org = services.transfer_ownership(request.user, org, target_member)
        return Response(
            OrganizationSerializer(updated_org, context={"request": request}).data
        )

    @extend_schema(
        methods=["POST"],
        summary="Leave the organization",
        description=(
            "Any member except the OWNER can leave. The OWNER must transfer "
            "ownership first. Unassigns that user's tasks in the organization."
        ),
        request=LeaveOrganizationSerializer,
        responses={
            204: None,
            400: ApiErrorSerializer,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        org = self.get_object()
        services.leave_organization(request.user, org)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        methods=["DELETE"],
        summary="Delete the organization",
        description=(
            "Only the OWNER may delete the organization. The request body must "
            "contain the exact organization name as confirmation. Cascades all "
            "projects, tasks, comments, activity, and pending invitations."
        ),
        request=DeleteOrganizationSerializer,
        responses={
            204: None,
            400: ApiErrorSerializer,
            401: ApiErrorSerializer,
            403: ApiErrorSerializer,
            404: ApiErrorSerializer,
            429: ApiErrorSerializer,
        },
    )
    def destroy(self, request, pk=None):
        org = self.get_object()
        s = DeleteOrganizationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.delete_organization(request.user, org, s.validated_data["name"])
        return Response(status=status.HTTP_204_NO_CONTENT)
