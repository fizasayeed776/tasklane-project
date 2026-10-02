"""Activity log approach: explicit service layer (not signals).
Signals hide who the actor is and can't see old values cheaply; the service has both, is easy to test,
and keeps assignment-email + log writes inside one transaction."""
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.organizations.models import OrganizationMember as M
from apps.organizations.services import ensure_role, role_of

from .jobs import send_assignment_email
from .models import Activity, Comment, Task


def _log(task, actor, verb, message):
    Activity.objects.create(organization_id=task.project.organization_id, task=task, actor=actor,
                            verb=verb, message=f"{actor.display_name} {message}")


def _check_assignee(task_org_id, user_id):
    if user_id and not M.objects.filter(organization_id=task_org_id, user_id=user_id).exists():
        raise ValidationError({"assigned_to": "Assignee must be a member of this organization."})


@transaction.atomic
def create_task(user, data):
    project = data["project"]
    ensure_role(user, project.organization_id, M.Role.MEMBER)
    assignee = data.get("assigned_to")
    _check_assignee(project.organization_id, getattr(assignee, "id", None))
    task = Task.objects.create(created_by=user, **data)
    _log(task, user, "task_created", f'created task "{task.title}".')
    if assignee:
        _log(task, user, "task_assigned", f"assigned task to {assignee.display_name}.")
        transaction.on_commit(lambda: send_assignment_email.delay(task.id))
    return task


@transaction.atomic
def update_task(user, task, data):
    org_id = task.project.organization_id
    role = ensure_role(user, org_id, M.Role.MEMBER)
    if role == M.Role.MEMBER and user.id not in (task.created_by_id, task.assigned_to_id):
        raise PermissionDenied("Members can only update tasks they created or are assigned to.")
    data.pop("project", None)  # tasks never move between projects/orgs
    if "assigned_to" in data:
        _check_assignee(org_id, getattr(data["assigned_to"], "id", None))
    old_status, old_priority, old_assignee = task.status, task.priority, task.assigned_to_id
    for k, v in data.items():
        setattr(task, k, v)
    task.save()
    if task.status != old_status:
        _log(task, user, "status_changed", f"changed task status from {old_status} to {task.status}.")
        if task.status == Task.Status.DONE:
            _log(task, user, "task_completed", f'completed task "{task.title}".')
    if task.priority != old_priority:
        _log(task, user, "priority_changed", f"changed task priority from {old_priority} to {task.priority}.")
    if task.assigned_to_id and task.assigned_to_id != old_assignee:
        _log(task, user, "task_assigned", f"assigned task to {task.assigned_to.display_name}.")
        transaction.on_commit(lambda: send_assignment_email.delay(task.id))
    return task


def delete_task(user, task):
    ensure_role(user, task.project.organization_id, M.Role.ADMIN)
    task.delete()


@transaction.atomic
def add_comment(user, task, content):
    ensure_role(user, task.project.organization_id, M.Role.MEMBER)
    comment = Comment.objects.create(task=task, user=user, content=content)
    _log(task, user, "comment_added", f'commented on "{task.title}".')
    return comment


def update_comment(user, comment, content):
    if comment.user_id != user.id:
        raise PermissionDenied("You can only edit your own comments.")
    comment.content = content
    comment.save()
    return comment


def delete_comment(user, comment):
    if comment.user_id != user.id and role_of(user, comment.task.project.organization_id) not in (M.Role.OWNER, M.Role.ADMIN):
        raise PermissionDenied("You can only delete your own comments.")
    comment.delete()
