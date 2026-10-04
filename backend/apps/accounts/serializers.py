from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework.validators import UniqueValidator
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name"]
        read_only_fields = ["id", "email"]


class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        attrs[self.username_field] = attrs[self.username_field].strip().lower()
        return super().validate(attrs)


class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(
        validators=[UniqueValidator(queryset=User.objects.all(), lookup="iexact")]
    )
    password = serializers.CharField(write_only=True)
    invite = serializers.CharField(write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "password",
            "invite",
        ]  # explicit: no mass assignment of is_staff etc.

    def validate_email(self, value):
        return value.strip().lower()

    def validate_password(self, value):
        validate_password(value)
        return value


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField()
    new_password = serializers.CharField()

    def validate_new_password(self, value):
        validate_password(value)
        return value


class ChangeEmailSerializer(serializers.Serializer):
    new_email = serializers.EmailField()
    current_password = serializers.CharField()

    def validate_new_email(self, value):
        return value.strip().lower()


class ForgotSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return value.strip().lower()


class ResetSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField()

    def validate_new_password(self, value):
        validate_password(value)
        return value


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class SuccessSerializer(serializers.Serializer):
    success = serializers.BooleanField()


class PasswordChangeResponseSerializer(SuccessSerializer):
    access = serializers.CharField()
    refresh = serializers.CharField()


class AuthApiErrorDetailSerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.CharField()
    details = serializers.JSONField(required=False)


class AuthApiErrorSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    error = AuthApiErrorDetailSerializer()
