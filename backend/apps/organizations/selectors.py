from django.shortcuts import get_object_or_404

from .models import Organization, OrganizationMember


def orgs_for_user(user):
    return Organization.objects.filter(memberships__user=user).order_by("name")


def members_of(org):
    return OrganizationMember.objects.filter(organization=org).select_related("user")


def member_in_organization(org, member_id):
    return get_object_or_404(
        OrganizationMember.objects.select_related("user"),
        organization=org,
        pk=member_id,
    )


def role_of(user, org_id):
    return (
        OrganizationMember.objects.filter(user=user, organization_id=org_id)
        .values_list("role", flat=True)
        .first()
    )
