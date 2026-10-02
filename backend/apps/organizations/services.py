import uuid
import secrets

from django.db import transaction
from django.utils.text import slugify
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User

from .models import (
    Organization,
    OrganizationMember,
    PendingInvitation,
    invitation_expiry,
)

R = OrganizationMember.Role
RANK = {R.VIEWER: 0, R.MEMBER: 1, R.ADMIN: 2, R.OWNER: 3}


def role_of(user, org_id):
    return (
        OrganizationMember.objects.filter(user=user, organization_id=org_id)
        .values_list("role", flat=True)
        .first()
    )


def ensure_role(user, org_id, minimum):
    """Single authorization choke point. Non-members and low roles both get 403."""
    role = role_of(user, org_id)
    if role is None or RANK[role] < RANK[minimum]:
        raise PermissionDenied("You do not have permission to perform this action.")
    return role


@transaction.atomic
def create_organization(user, name):
    org = Organization.objects.create(
        name=name, owner=user, slug=f"{slugify(name)}-{uuid.uuid4().hex[:6]}"
    )
    OrganizationMember.objects.create(organization=org, user=user, role=R.OWNER)
    return org


@transaction.atomic
def invite_member(actor, org, email, role):
    actor_role = ensure_role(actor, org.id, R.ADMIN)
    if role == R.OWNER:
        raise ValidationError({"role": "Cannot invite as OWNER."})
    if role == R.ADMIN and actor_role != R.OWNER:
        raise PermissionDenied("Only the organization owner can invite an admin.")

    user = User.objects.filter(email__iexact=email).first()
    if user:
        if OrganizationMember.objects.filter(organization=org, user=user).exists():
            raise ValidationError({"email": "This user is already a member."})
        member = OrganizationMember.objects.create(
            organization=org, user=user, role=role
        )
        PendingInvitation.objects.filter(
            organization=org,
            email__iexact=email,
            accepted_at__isnull=True,
        ).update(accepted_at=timezone.now())
        return member

    invitation = (
        PendingInvitation.objects.select_for_update()
        .filter(organization=org, email__iexact=email)
        .first()
    )
    if invitation is None:
        invitation = PendingInvitation.objects.create(
            organization=org,
            email=email,
            role=role,
            invited_by=actor,
        )
    else:
        invitation.email = email
        invitation.role = role
        invitation.invited_by = actor
        invitation.token = secrets.token_urlsafe()
        invitation.accepted_at = None
        invitation.expires_at = invitation_expiry()
        invitation.save(
            update_fields=[
                "email",
                "role",
                "invited_by",
                "token",
                "accepted_at",
                "expires_at",
            ]
        )

    from .tasks import send_invitation_email

    transaction.on_commit(lambda: send_invitation_email.delay(invitation.id))
    return invitation


def _validate_invitation(invitation, email=None):
    if invitation.accepted_at is not None:
        raise ValidationError({"invite": "This invitation has already been used."})
    if invitation.expires_at <= timezone.now():
        raise ValidationError({"invite": "This invitation has expired."})
    if email and invitation.email.casefold() != email.casefold():
        raise ValidationError(
            {"email": "Use the email address that received this invitation."}
        )


@transaction.atomic
def accept_pending_invitations(user, token=None):
    now = timezone.now()
    if token:
        invitation = (
            PendingInvitation.objects.select_for_update().filter(token=token).first()
        )
        if invitation is None:
            raise ValidationError({"invite": "This invitation is invalid or expired."})
        _validate_invitation(invitation, user.email)
        invitations = [invitation]
    else:
        invitations = list(
            PendingInvitation.objects.select_for_update().filter(
                email__iexact=user.email,
                accepted_at__isnull=True,
                expires_at__gt=now,
            )
        )

    accepted = 0
    for invitation in invitations:
        _validate_invitation(invitation, user.email)
        OrganizationMember.objects.get_or_create(
            organization=invitation.organization,
            user=user,
            defaults={"role": invitation.role},
        )
        invitation.accepted_at = now
        invitation.save(update_fields=["accepted_at"])
        accepted += 1
    return accepted


@transaction.atomic
def change_member_role(actor, org, member, new_role):
    actor_role = ensure_role(actor, org.id, R.ADMIN)
    if member.organization_id != org.id:
        raise ValidationError(
            {"member": "Member does not belong to this organization."}
        )
    if member.user_id == actor.id:
        raise PermissionDenied("You cannot change your own organization role.")
    if member.role == R.OWNER:
        raise PermissionDenied("The organization owner cannot be managed as a member.")
    if new_role == R.OWNER:
        raise ValidationError({"role": "The owner role cannot be assigned here."})
    if actor_role != R.OWNER and (member.role == R.ADMIN or new_role == R.ADMIN):
        raise PermissionDenied("Only the organization owner can manage admins.")
    if member.role != new_role:
        member.role = new_role
        member.save(update_fields=["role"])
    return member


@transaction.atomic
def remove_member(actor, org, member):
    actor_role = ensure_role(actor, org.id, R.ADMIN)
    if member.organization_id != org.id:
        raise ValidationError(
            {"member": "Member does not belong to this organization."}
        )
    if member.user_id == actor.id:
        raise PermissionDenied("You cannot remove yourself from the organization.")
    if member.role == R.OWNER:
        raise PermissionDenied("The organization owner cannot be removed.")
    if actor_role != R.OWNER and member.role not in {R.MEMBER, R.VIEWER}:
        raise PermissionDenied("Admins can only manage members and viewers.")
    member.delete()
