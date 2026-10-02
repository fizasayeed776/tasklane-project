from django.db import transaction

from apps.organizations.services import accept_pending_invitations

from .models import User


@transaction.atomic
def register_user(data):
    data = dict(data)
    invitation_token = data.pop("invite", None)
    user = User.objects.create_user(**data)
    accept_pending_invitations(user, invitation_token)
    return user
