from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone


@shared_task
def send_assignment_email(task_id):
    from .models import Task

    task = Task.objects.select_related("assigned_to").filter(pk=task_id).first()
    if task and task.assigned_to:
        send_mail(
            f"You were assigned: {task.title}",
            f"Task '{task.title}' is now yours.",
            settings.DEFAULT_FROM_EMAIL,
            [task.assigned_to.email],
        )


@shared_task
def flag_overdue_tasks():
    from apps.notifications.services import publish_notification

    from .models import Activity, Task

    today = timezone.localdate()
    notified_at = timezone.now()

    with transaction.atomic():
        overdue_tasks = list(
            Task.objects.select_for_update(of=("self",))
            .select_related("project", "assigned_to")
            .filter(
                due_date__lt=today,
                overdue_notified_at__isnull=True,
            )
            .exclude(status=Task.Status.DONE)
        )
        if not overdue_tasks:
            return 0

        task_ids = [task.id for task in overdue_tasks]
        Task.objects.filter(
            id__in=task_ids,
            overdue_notified_at__isnull=True,
        ).update(overdue_notified_at=notified_at)
        Activity.objects.bulk_create(
            [
                Activity(
                    organization_id=task.project.organization_id,
                    task_id=task.id,
                    verb="task_overdue",
                    message=f'Task "{task.title}" is overdue.',
                )
                for task in overdue_tasks
            ]
        )
        for task in overdue_tasks:
            if task.assigned_to_id:
                transaction.on_commit(
                    lambda task=task: publish_notification(
                        task.project.organization_id,
                        "task_overdue",
                        f'Task "{task.title}" is overdue.',
                        task.id,
                        task.assigned_to_id,
                    )
                )

    return len(overdue_tasks)
