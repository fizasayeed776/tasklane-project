from celery import shared_task

from .services import prune_read_notifications


@shared_task
def prune_read_notifications_job():
    return prune_read_notifications()
