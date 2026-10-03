from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from .models import User


def user_by_email(email):
    return User.objects.filter(email__iexact=email).first()


def user_by_pk(user_id):
    try:
        pk = int(user_id)
    except (TypeError, ValueError):
        return None
    return User.objects.filter(pk=pk).first()


def email_is_used_by_another_user(email, user_id):
    return User.objects.filter(email__iexact=email).exclude(pk=user_id).exists()


def outstanding_tokens_for_user(user):
    return OutstandingToken.objects.filter(user=user)
