from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.utils import extend_schema

from apps.organizations.services import accept_pending_invitations

from . import services
from .models import User
from .serializers import (
    AuthApiErrorSerializer,
    ChangeEmailSerializer,
    ChangePasswordSerializer,
    ForgotSerializer,
    LogoutSerializer,
    PasswordChangeResponseSerializer,
    RegisterSerializer,
    ResetSerializer,
    SuccessSerializer,
    UserSerializer,
)


class ThrottledMixin:
    throttle_scope = "auth"  # brute-force protection: 10 req/min


class RegisterView(ThrottledMixin, generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def perform_create(self, serializer):
        serializer.instance = services.register_user(serializer.validated_data)


class LoginView(ThrottledMixin, TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            user = User.objects.filter(
                email__iexact=request.data.get("email", "")
            ).first()
            if user:
                accept_pending_invitations(user)
        return response


class RefreshView(ThrottledMixin, TokenRefreshView):
    pass


class LogoutView(ThrottledMixin, APIView):
    @extend_schema(request=LogoutSerializer, responses={204: None})
    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            raise ValidationError("Invalid refresh token.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class ChangePasswordView(ThrottledMixin, APIView):
    @extend_schema(
        summary="Change the authenticated user's password",
        description=(
            "Changes only the authenticated account, regardless of organization role. "
            "Existing refresh tokens are revoked and a replacement token pair is returned."
        ),
        request=ChangePasswordSerializer,
        responses={
            200: PasswordChangeResponseSerializer,
            400: AuthApiErrorSerializer,
            401: AuthApiErrorSerializer,
            429: AuthApiErrorSerializer,
            500: AuthApiErrorSerializer,
        },
    )
    def post(self, request):
        s = ChangePasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        result = services.change_password(
            request.user,
            s.validated_data["old_password"],
            s.validated_data["new_password"],
        )
        return Response(result)


class ChangeEmailView(ThrottledMixin, APIView):
    @extend_schema(
        summary="Change the authenticated user's email",
        description=(
            "Changes only the authenticated account, regardless of organization role. "
            "Requires the current password and sends a notification to the old email address."
        ),
        request=ChangeEmailSerializer,
        responses={
            200: SuccessSerializer,
            400: AuthApiErrorSerializer,
            401: AuthApiErrorSerializer,
            429: AuthApiErrorSerializer,
            500: AuthApiErrorSerializer,
        },
    )
    def post(self, request):
        serializer = ChangeEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = services.change_email(
            request.user,
            serializer.validated_data["new_email"],
            serializer.validated_data["current_password"],
        )
        return Response(result)


class ForgotPasswordView(ThrottledMixin, APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=ForgotSerializer, responses={200: SuccessSerializer})
    def post(self, request):
        s = ForgotSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=s.validated_data["email"]).first()
        if user:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
            send_mail(
                "Reset your password", link, settings.DEFAULT_FROM_EMAIL, [user.email]
            )
        return Response(
            {"success": True}
        )  # same answer either way: no account enumeration


class ResetPasswordView(ThrottledMixin, APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=ResetSerializer, responses={200: SuccessSerializer})
    def post(self, request):
        s = ResetSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            user = User.objects.get(
                pk=force_str(urlsafe_base64_decode(s.validated_data["uid"]))
            )
        except (User.DoesNotExist, ValueError, TypeError):
            raise ValidationError("Invalid reset link.")
        if not default_token_generator.check_token(user, s.validated_data["token"]):
            raise ValidationError("Invalid or expired reset link.")
        user.set_password(s.validated_data["new_password"])
        user.save()
        return Response({"success": True})
