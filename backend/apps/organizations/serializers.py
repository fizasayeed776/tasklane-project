from rest_framework import serializers

from .models import Organization, OrganizationMember
from .services import role_of


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
        choices=OrganizationMember.Role.choices, default="MEMBER"
    )
