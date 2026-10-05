"""Tests that Celery autodiscover finds every task used in CELERY_BEAT_SCHEDULE."""


def test_all_scheduled_tasks_are_registered():
    """Import default modules (mimicking worker startup) and verify that every
    task referenced by CELERY_BEAT_SCHEDULE is present in the Celery registry.

    This guards against the failure mode where a task lives in a non-standard
    module (e.g. jobs.py instead of tasks.py) and autodiscover_tasks() misses
    it, causing Beat to silently drop scheduled executions.
    """
    from django.conf import settings

    from config.celery import app

    # Replicate what the Celery worker does at startup.
    app.loader.import_default_modules()

    registered = set(app.tasks.keys())

    # Mandatory tasks that the Beat schedule depends on.
    expected = {
        "apps.tasks.jobs.flag_overdue_tasks",
        "apps.organizations.jobs.prune_stale_invitations",
    }
    missing = expected - registered
    assert not missing, (
        f"The following tasks are in CELERY_BEAT_SCHEDULE but not registered "
        f"with the Celery worker: {sorted(missing)}"
    )

    # Also confirm every Beat entry resolves to a registered task.
    beat_tasks = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
    unregistered_beat = beat_tasks - registered
    assert not unregistered_beat, (
        f"Beat schedule entries pointing at unregistered tasks: "
        f"{sorted(unregistered_beat)}"
    )
