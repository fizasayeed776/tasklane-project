from django.db import transaction
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework.exceptions import ValidationError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.organizations.services import accept_pending_invitations

from . import selectors
from .models import User


@transaction.atomic
def register_user(data):
    data = dict(data)
    invitation_token = data.pop("invite", None)
    user = User.objects.create_user(**data)
    organization_id = None
    if invitation_token:
        from apps.organizations.models import OrganizationMember

        accept_pending_invitations(user, invitation_token)
        membership = OrganizationMember.objects.filter(user=user).first()
        if membership:
            organization_id = membership.organization_id
    user._joined_organization_id = organization_id
    return user


@transaction.atomic
def change_password(user, old_password, new_password):
    if not user.check_password(old_password):
        raise ValidationError("Old password is incorrect.")
    if old_password == new_password:
        raise ValidationError("New password must be different from the old password.")

    user.set_password(new_password)
    user.save(update_fields=["password"])

    revoke_refresh_tokens(user)
    refresh = RefreshToken.for_user(user)
    return {
        "success": True,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


def revoke_refresh_tokens(user):
    for outstanding_token in selectors.outstanding_tokens_for_user(user):
        BlacklistedToken.objects.get_or_create(token=outstanding_token)


@transaction.atomic
def reset_password(user, new_password):
    user.set_password(new_password)
    user.save(update_fields=["password"])
    revoke_refresh_tokens(user)


@transaction.atomic
def change_email(user, new_email, current_password):
    if not user.check_password(current_password):
        raise ValidationError("Current password is incorrect.")

    if new_email.casefold() == user.email.casefold():
        raise ValidationError("New email must be different from the current email.")
    if selectors.email_is_used_by_another_user(new_email, user.pk):
        raise ValidationError("A user with this email already exists.")

    old_email = user.email
    user.email = new_email
    user.save(update_fields=["email"])
    send_mail(
        "Your Tasklane email address was changed",
        (
            f"The email address for your Tasklane account was changed to "
            f"{new_email}. If you did not make this change, please contact "
            "support immediately."
        ),
        settings.DEFAULT_FROM_EMAIL,
        [old_email],
    )
    return {"success": True}


def send_password_reset(email):
    user = selectors.user_by_email(email)
    if user is None:
        return

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    send_mail("Reset your password", link, settings.DEFAULT_FROM_EMAIL, [user.email])


def reset_password_with_token(uid, token, new_password):
    try:
        user_id = force_str(urlsafe_base64_decode(uid))
    except Exception:
        raise ValidationError("Invalid reset link.")
    user = selectors.user_by_pk(user_id)
    if user is None:
        raise ValidationError("Invalid reset link.")
    if not default_token_generator.check_token(user, token):
        raise ValidationError("Invalid or expired reset link.")
    reset_password(user, new_password)
