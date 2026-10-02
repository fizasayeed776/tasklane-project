from .models import Activity, Comment, Task


def _scope(qs, org_id, field):
    return qs.filter(**{field: org_id}) if org_id and str(org_id).isdigit() else qs


def tasks_for_user(user, org_id=None):
    qs = Task.objects.filter(project__organization__memberships__user=user).select_related("assigned_to", "created_by")
    return _scope(qs, org_id, "project__organization_id")


def activity_for_user(user, org_id=None):
    qs = Activity.objects.filter(organization__memberships__user=user).select_related("actor")
    return _scope(qs, org_id, "organization_id").order_by("-created_at")


def comments_for_user(user):
    return Comment.objects.filter(task__project__organization__memberships__user=user).select_related("user")
