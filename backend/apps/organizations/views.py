from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.projects.serializers import ProjectSerializer

from . import selectors, services
from .serializers import InviteSerializer, MemberSerializer, OrganizationSerializer


class OrganizationViewSet(mixins.CreateModelMixin, mixins.ListModelMixin,
                          mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = OrganizationSerializer
    pagination_class = None

    def get_queryset(self):  # tenant boundary: only orgs the caller belongs to -> others are 404
        return selectors.orgs_for_user(self.request.user)

    def perform_create(self, serializer):
        serializer.instance = services.create_organization(self.request.user, serializer.validated_data["name"])

    @action(detail=True, methods=["get", "post"])
    def members(self, request, pk=None):
        org = self.get_object()
        if request.method == "POST":
            s = InviteSerializer(data=request.data)
            s.is_valid(raise_exception=True)
            member = services.invite_member(request.user, org, **s.validated_data)
            return Response(MemberSerializer(member).data, status=status.HTTP_201_CREATED)
        return Response(MemberSerializer(selectors.members_of(org), many=True).data)

    @action(detail=True, methods=["get"])
    def projects(self, request, pk=None):
        org = self.get_object()  # GET /api/organizations/2/projects/ by a non-member -> 404, no data
        return Response(ProjectSerializer(org.projects.all(), many=True).data)
