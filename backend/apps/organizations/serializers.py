from rest_framework import serializers

from .models import Organization, OrganizationMember, PendingInvitation
from .selectors import role_of


class ApiErrorDetailSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    details = serializers.JSONField(required=False)


class ApiErrorSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    error = ApiErrorDetailSerializer()


class OrganizationSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "role", "created_at"]
        read_only_fields = ["id", "slug", "created_at"]

    def get_role(self, obj) -> str | None:
        return role_of(self.context["request"].user, obj.id)


class MemberSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source="user.email", read_only=True)
    name = serializers.CharField(source="user.display_name", read_only=True)
    user_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = OrganizationMember
        fields = ["id", "user_id", "email", "name", "role"]


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=[
            OrganizationMember.Role.ADMIN,
            OrganizationMember.Role.MEMBER,
            OrganizationMember.Role.VIEWER,
        ],
        default="MEMBER",
    )


class MemberRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(
        choices=[
            OrganizationMember.Role.ADMIN,
            OrganizationMember.Role.MEMBER,
            OrganizationMember.Role.VIEWER,
        ]
    )


class PendingInvitationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PendingInvitation
        fields = ["email", "role"]


class InviteResultSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=[
            OrganizationMember.Role.ADMIN,
            OrganizationMember.Role.MEMBER,
            OrganizationMember.Role.VIEWER,
        ]
    )
    pending = serializers.BooleanField()


class TransferOwnershipSerializer(serializers.Serializer):
    member_id = serializers.IntegerField()


class LeaveOrganizationSerializer(serializers.Serializer):
    pass  # no body required


class DeleteOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(help_text="Must exactly match the organization name.")
