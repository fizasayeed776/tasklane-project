from django.db import transaction
from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.core.mail import send_mail
from rest_framework.exceptions import ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.organizations.services import accept_pending_invitations

from .models import User


@transaction.atomic
def register_user(data):
    data = dict(data)
    invitation_token = data.pop("invite", None)
    user = User.objects.create_user(**data)
    accept_pending_invitations(user, invitation_token)
    return user


@transaction.atomic
def change_password(user, old_password, new_password):
    if not user.check_password(old_password):
        raise ValidationError("Old password is incorrect.")
    if old_password == new_password:
        raise ValidationError("New password must be different from the old password.")

    user.set_password(new_password)
    user.save(update_fields=["password"])

    for outstanding_token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding_token)

    refresh = RefreshToken.for_user(user)
    return {
        "success": True,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


@transaction.atomic
def change_email(user, new_email, current_password):
    if not user.check_password(current_password):
        raise ValidationError("Current password is incorrect.")

    normalized_email = BaseUserManager.normalize_email(new_email.strip()).lower()
    if normalized_email.casefold() == user.email.casefold():
        raise ValidationError("New email must be different from the current email.")
    if User.objects.filter(email__iexact=normalized_email).exclude(pk=user.pk).exists():
        raise ValidationError("A user with this email already exists.")

    old_email = user.email
    user.email = normalized_email
    user.save(update_fields=["email"])
    send_mail(
        "Your Tasklane email address was changed",
        (
            f"The email address for your Tasklane account was changed to "
            f"{normalized_email}. If you did not make this change, please contact "
            "support immediately."
        ),
        settings.DEFAULT_FROM_EMAIL,
        [old_email],
    )
    return {"success": True}
