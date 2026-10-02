from datetime import date

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail


@shared_task
def send_assignment_email(task_id):
    from .models import Task

    task = Task.objects.select_related("assigned_to").filter(pk=task_id).first()
    if task and task.assigned_to:
        send_mail(f"You were assigned: {task.title}", f"Task '{task.title}' is now yours.",
                  settings.DEFAULT_FROM_EMAIL, [task.assigned_to.email])


@shared_task
def flag_overdue_tasks():
    from .models import Task

    return Task.objects.filter(due_date__lt=date.today()).exclude(status="DONE").count()
