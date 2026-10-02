import uuid

from django.db import transaction
from django.utils.text import slugify
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User

from .models import Organization, OrganizationMember

R = OrganizationMember.Role
RANK = {R.VIEWER: 0, R.MEMBER: 1, R.ADMIN: 2, R.OWNER: 3}


def role_of(user, org_id):
    return (OrganizationMember.objects.filter(user=user, organization_id=org_id)
            .values_list("role", flat=True).first())


def ensure_role(user, org_id, minimum):
    """Single authorization choke point. Non-members and low roles both get 403."""
    role = role_of(user, org_id)
    if role is None or RANK[role] < RANK[minimum]:
        raise PermissionDenied("You do not have permission to perform this action.")
    return role


@transaction.atomic
def create_organization(user, name):
    org = Organization.objects.create(name=name, owner=user, slug=f"{slugify(name)}-{uuid.uuid4().hex[:6]}")
    OrganizationMember.objects.create(organization=org, user=user, role=R.OWNER)
    return org


def invite_member(actor, org, email, role):
    ensure_role(actor, org.id, R.ADMIN)
    if role == R.OWNER:
        raise ValidationError("Cannot invite as OWNER.")
    user = User.objects.filter(email__iexact=email).first()
    if not user:
        raise ValidationError("No registered user with that email.")
    member, _ = OrganizationMember.objects.get_or_create(organization=org, user=user, defaults={"role": role})
    return member
