import uuid
import secrets

from django.db import transaction
from django.utils.text import slugify
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User

from .selectors import role_of
from .models import (
    Organization,
    OrganizationMember,
    PendingInvitation,
    invitation_expiry,
)

R = OrganizationMember.Role
RANK = {R.VIEWER: 0, R.MEMBER: 1, R.ADMIN: 2, R.OWNER: 3}


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
def accept_pending_invitations(user, token):
    """Accept a pending invitation by token.

    A token is always required — email ownership is only proven by clicking
    the emailed link.  Registering or logging in without the token never
    grants organization membership.
    """
    if not token:
        raise ValidationError({"invite": "An invitation token is required."})

    invitation = (
        PendingInvitation.objects.select_for_update().filter(token=token).first()
    )
    if invitation is None:
        raise ValidationError({"invite": "This invitation is invalid or expired."})

    _validate_invitation(invitation, user.email)

    OrganizationMember.objects.get_or_create(
        organization=invitation.organization,
        user=user,
        defaults={"role": invitation.role},
    )
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["accepted_at"])
    return 1


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


@transaction.atomic
def transfer_ownership(actor, org, target_member):
    """Transfer organization ownership to an existing member.

    Only the current OWNER may call this. The target must be an existing member
    of the same organization (not a pending invite). After the transfer:
      - target becomes OWNER
      - previous owner becomes ADMIN
      - Organization.owner is updated
    An activity entry is written on the organization.
    """
    ensure_role(actor, org.id, R.OWNER)
    # Must be exactly OWNER — ensure_role allows OWNER and above so re-check
    actor_membership = OrganizationMember.objects.filter(
        organization=org, user=actor
    ).first()
    if not actor_membership or actor_membership.role != R.OWNER:
        raise PermissionDenied("Only the organization owner can transfer ownership.")

    if target_member.organization_id != org.id:
        raise ValidationError(
            {"member_id": "That member does not belong to this organization."}
        )
    if target_member.user_id == actor.id:
        raise ValidationError(
            {"member_id": "You are already the owner of this organization."}
        )

    # Promote target to OWNER
    target_member.role = R.OWNER
    target_member.save(update_fields=["role"])

    # Demote old owner to ADMIN
    actor_membership.role = R.ADMIN
    actor_membership.save(update_fields=["role"])

    # Update the Organization.owner FK
    org.owner = target_member.user
    org.save(update_fields=["owner"])

    # Write an activity entry (org-level, no task)
    from apps.tasks.models import Activity

    Activity.objects.create(
        organization=org,
        task=None,
        actor=actor,
        verb="ownership_transferred",
        message=(
            f"{actor.display_name} transferred ownership of {org.name} to "
            f"{target_member.user.display_name}."
        ),
    )
    return org


@transaction.atomic
def leave_organization(actor, org):
    """Remove the calling user from the organization.

    The OWNER cannot leave — they must transfer ownership first.
    Unassigns the user's tasks within the organization.
    """
    membership = OrganizationMember.objects.filter(organization=org, user=actor).first()
    if membership is None:
        raise PermissionDenied("You are not a member of this organization.")
    if membership.role == R.OWNER:
        raise ValidationError(
            {
                "detail": (
                    "The organization owner cannot leave. Transfer ownership to "
                    "another member first."
                )
            }
        )

    # Unassign tasks this user owns in this organization
    from apps.tasks.models import Task

    Task.objects.filter(project__organization=org, assigned_to=actor).update(
        assigned_to=None
    )

    membership.delete()


@transaction.atomic
def delete_organization(actor, org, name_confirmation):
    """Delete the organization and all its data.

    Only the OWNER may do this. The request must confirm the organization name.
    Cascades: projects, tasks, comments, activity, pending invitations.
    """
    if role_of(actor, org.id) != R.OWNER:
        raise PermissionDenied(
            "Only the organization owner can delete the organization."
        )

    if name_confirmation.strip() != org.name:
        raise ValidationError(
            {
                "name": (
                    f'The name you entered does not match "{org.name}". '
                    "Type the exact organization name to confirm deletion."
                )
            }
        )

    # Django CASCADE on Organization → memberships, projects (→ tasks → comments,
    # activity), pending_invitations.  A single delete() is sufficient.
    org.delete()
