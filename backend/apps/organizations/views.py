from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, extend_schema

from apps.projects.serializers import ProjectSerializer

from . import selectors, services
from .models import Organization, PendingInvitation
from .serializers import (
    InviteResultSerializer,
    InviteSerializer,
    MemberRoleSerializer,
    MemberSerializer,
    OrganizationSerializer,
    PendingInvitationSerializer,
    ApiErrorSerializer,
)


class OrganizationViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Organization.objects.none()
    serializer_class = OrganizationSerializer
    pagination_class = None

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
                result = PendingInvitationSerializer(member).data
                result["pending"] = True
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
