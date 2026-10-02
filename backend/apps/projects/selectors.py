from .models import Project


def projects_for_user(user, org_id=None):
    qs = Project.objects.filter(organization__memberships__user=user)
    if org_id and str(org_id).isdigit():
        qs = qs.filter(organization_id=org_id)
    return qs
