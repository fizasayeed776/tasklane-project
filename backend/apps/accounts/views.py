from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from drf_spectacular.utils import extend_schema

from . import services
from .permissions import IsAuthenticatedAccountUser
from .serializers import (
    AuthApiErrorSerializer,
    ChangeEmailSerializer,
    ChangePasswordSerializer,
    ForgotSerializer,
    LogoutSerializer,
    LoginSerializer,
    PasswordChangeResponseSerializer,
    RegisterSerializer,
    ResetSerializer,
    SuccessSerializer,
    UserSerializer,
)


# Each unauthenticated auth endpoint gets its own throttle scope so that a
# burst on one endpoint (e.g. many refresh calls) cannot lock users out of
# another (e.g. login).  Authenticated account-mutation endpoints share a
# separate scope so they are never grouped with the unauthenticated paths.


class _LoginThrottle:
    throttle_scope = "auth_login"


class _RegisterThrottle:
    throttle_scope = "auth_register"


class _RefreshThrottle:
    throttle_scope = "auth_refresh"


class _PasswordThrottle:
    """Shared by forgot-password and reset-password."""

    throttle_scope = "auth_password"


class _AccountThrottle:
    """Authenticated account-mutation endpoints (change-password, change-email, logout)."""

    throttle_scope = "auth_account"


class RegisterView(_RegisterThrottle, generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def perform_create(self, serializer):
        serializer.instance = services.register_user(serializer.validated_data)


class LoginView(_LoginThrottle, TokenObtainPairView):
    serializer_class = LoginSerializer


class RefreshView(_RefreshThrottle, TokenRefreshView):
    pass


class LogoutView(_AccountThrottle, APIView):
    permission_classes = [IsAuthenticatedAccountUser]

    @extend_schema(request=LogoutSerializer, responses={204: None})
    def post(self, request):
        try:
            RefreshToken(request.data.get("refresh", "")).blacklist()
        except TokenError:
            raise ValidationError("Invalid refresh token.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticatedAccountUser]

    def get_object(self):
        return self.request.user


class ChangePasswordView(_AccountThrottle, APIView):
    permission_classes = [IsAuthenticatedAccountUser]

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


class ChangeEmailView(_AccountThrottle, APIView):
    permission_classes = [IsAuthenticatedAccountUser]

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


class ForgotPasswordView(_PasswordThrottle, APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=ForgotSerializer, responses={200: SuccessSerializer})
    def post(self, request):
        s = ForgotSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.send_password_reset(s.validated_data["email"])
        return Response(
            {"success": True}
        )  # same answer either way: no account enumeration


class ResetPasswordView(_PasswordThrottle, APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(request=ResetSerializer, responses={200: SuccessSerializer})
    def post(self, request):
        s = ResetSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        services.reset_password_with_token(
            s.validated_data["uid"],
            s.validated_data["token"],
            s.validated_data["new_password"],
        )
        return Response({"success": True})
