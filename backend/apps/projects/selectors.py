from .models import Project


def projects_for_user(user, org_id=None):
    qs = Project.objects.filter(organization__memberships__user=user)
    if org_id is not None:
        if not str(org_id).isdigit():
            return qs.none()
        qs = qs.filter(organization_id=org_id)
    return qs
