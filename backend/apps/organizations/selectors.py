from .models import Organization, OrganizationMember


def orgs_for_user(user):
    return Organization.objects.filter(memberships__user=user).order_by("name")


def members_of(org):
    return OrganizationMember.objects.filter(organization=org).select_related("user")
