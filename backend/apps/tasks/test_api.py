"""Task API and tenant-isolation tests."""

from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.organizations.models import OrganizationMember
from apps.organizations.services import create_organization
from apps.projects.models import Project
from apps.tasks.models import Activity, Comment, Task


def as_user(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@pytest.fixture
def world(db):
    a = User.objects.create_user("a@x.com", "Passw0rd!x")
    b = User.objects.create_user("b@x.com", "Passw0rd!x")
    org_a, org_b = create_organization(a, "A"), create_organization(b, "B")
    proj_a = Project.objects.create(organization=org_a, name="PA", created_by=a)
    proj_b = Project.objects.create(organization=org_b, name="PB", created_by=b)
    task_b = Task.objects.create(project=proj_b, title="secret", created_by=b)
    return dict(a=a, b=b, org_a=org_a, org_b=org_b, proj_a=proj_a, task_b=task_b)


def test_cannot_access_other_org_task(world):
    c = as_user(world["a"])
    assert c.get(f"/api/tasks/{world['task_b'].id}/").status_code == 404
    assert (
        c.patch(f"/api/tasks/{world['task_b'].id}/", {"title": "x"}).status_code == 404
    )
    assert c.get("/api/tasks/").json()["results"] == []


def test_cannot_list_other_org_projects(world):
    r = as_user(world["a"]).get(f"/api/organizations/{world['org_b'].id}/projects/")
    assert r.status_code == 404 and r.json()["success"] is False


def test_cannot_create_project_in_foreign_org(world):
    r = as_user(world["a"]).post(
        "/api/projects/", {"name": "x", "organization_id": world["org_b"].id}
    )
    assert r.status_code == 403


def test_viewer_cannot_create_task(world):
    v = User.objects.create_user("v@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"], user=v, role="VIEWER"
    )
    r = as_user(v).post("/api/tasks/", {"project": world["proj_a"].id, "title": "t"})
    assert r.status_code == 403


def test_viewer_cannot_mutate_tasks_or_add_comments(world):
    viewer = User.objects.create_user("viewer@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"],
        user=viewer,
        role=OrganizationMember.Role.VIEWER,
    )
    task = Task.objects.create(
        project=world["proj_a"], title="Read only", created_by=world["a"]
    )
    client = as_user(viewer)

    assert (
        client.patch(f"/api/tasks/{task.id}/", {"title": "Changed"}).status_code == 403
    )
    assert client.delete(f"/api/tasks/{task.id}/").status_code == 403
    assert (
        client.post(f"/api/tasks/{task.id}/comments/", {"content": "No"}).status_code
        == 403
    )


def test_status_change_logs_activity(world):
    c = as_user(world["a"])
    t = c.post("/api/tasks/", {"project": world["proj_a"].id, "title": "t"}).json()
    c.patch(f"/api/tasks/{t['id']}/", {"status": "REVIEW"})
    assert Activity.objects.filter(verb="status_changed").exists()


def test_register_and_login(db):
    c = APIClient()
    assert (
        c.post(
            "/api/auth/register/", {"email": "n@x.com", "password": "Passw0rd!x"}
        ).status_code
        == 201
    )
    assert (
        "access"
        in c.post(
            "/api/auth/login/", {"email": "n@x.com", "password": "Passw0rd!x"}
        ).json()
    )


def test_combined_task_filters_search_and_ordering(world):
    assignee = User.objects.create_user("assigned@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"], user=assignee, role=OrganizationMember.Role.MEMBER
    )
    Task.objects.create(
        project=world["proj_a"],
        title="High assigned",
        status="TODO",
        priority="HIGH",
        assigned_to=assignee,
        created_by=world["a"],
    )
    Task.objects.create(
        project=world["proj_a"],
        title="High complete",
        status="DONE",
        priority="HIGH",
        assigned_to=assignee,
        created_by=world["a"],
    )
    Task.objects.create(
        project=world["proj_a"],
        title="Low assigned",
        status="TODO",
        priority="LOW",
        assigned_to=assignee,
        created_by=world["a"],
    )
    client = as_user(world["a"])
    response = client.get(
        f"/api/tasks/?status=TODO&priority=HIGH&assigned_to={assignee.id}"
    )
    assert response.status_code == 200
    assert [item["title"] for item in response.json()["results"]] == ["High assigned"]

    response = client.get("/api/tasks/?search=assigned&ordering=-created_at")
    assert [item["title"] for item in response.json()["results"]] == [
        "Low assigned",
        "High assigned",
    ]


def test_comment_owner_can_edit_and_admin_can_moderate(world):
    author = User.objects.create_user("author@x.com", "Passw0rd!x")
    admin = User.objects.create_user("admin@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"], user=author, role=OrganizationMember.Role.MEMBER
    )
    OrganizationMember.objects.create(
        organization=world["org_a"], user=admin, role=OrganizationMember.Role.ADMIN
    )
    author_client = as_user(author)
    response = author_client.post(
        f"/api/tasks/{world['task_b'].id}/comments/", {"content": "foreign"}
    )
    assert response.status_code == 404

    task = Task.objects.create(
        project=world["proj_a"], title="Discuss", created_by=world["a"]
    )
    response = author_client.post(
        f"/api/tasks/{task.id}/comments/", {"content": "Original"}
    )
    assert response.status_code == 201
    comment_id = response.json()["id"]
    assert Comment.objects.get(pk=comment_id).user_id == author.id

    response = author_client.patch(f"/api/comments/{comment_id}/", {})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID"

    response = author_client.patch(f"/api/comments/{comment_id}/", {"content": "  "})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID"

    response = author_client.patch(
        f"/api/comments/{comment_id}/", {"content": "Edited"}
    )
    assert response.status_code == 200
    assert response.json()["content"] == "Edited"
    assert (
        as_user(world["a"])
        .patch(f"/api/comments/{comment_id}/", {"content": "Not yours"})
        .status_code
        == 403
    )
    assert author_client.delete(f"/api/comments/{comment_id}/").status_code == 204

    moderated = Comment.objects.create(task=task, user=author, content="Moderate me")
    assert as_user(admin).delete(f"/api/comments/{moderated.id}/").status_code == 204
    assert not Comment.objects.filter(pk=moderated.id).exists()


def test_non_admin_cannot_delete_another_users_comment(world):
    task = Task.objects.create(
        project=world["proj_a"], title="Discuss", created_by=world["a"]
    )
    author = User.objects.create_user("author@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"], user=author, role=OrganizationMember.Role.MEMBER
    )
    comment = Comment.objects.create(task=task, user=author, content="Keep me")

    response = as_user(world["a"]).delete(f"/api/comments/{comment.id}/")
    assert response.status_code == 204  # the organization owner may moderate
    assert not Comment.objects.filter(pk=comment.id).exists()

    comment = Comment.objects.create(task=task, user=author, content="Keep me")
    another_member = User.objects.create_user("member@x.com", "Passw0rd!x")
    OrganizationMember.objects.create(
        organization=world["org_a"],
        user=another_member,
        role=OrganizationMember.Role.MEMBER,
    )
    response = as_user(another_member).delete(f"/api/comments/{comment.id}/")
    assert response.status_code == 403
    assert Comment.objects.filter(pk=comment.id).exists()


def test_cross_organization_task_comment_and_activity_access_is_hidden(world):
    foreign_task = world["task_b"]
    foreign_comment = Comment.objects.create(
        task=foreign_task, user=world["b"], content="Secret comment"
    )
    Activity.objects.create(
        organization=world["org_b"],
        task=foreign_task,
        actor=world["b"],
        verb="secret",
        message="Secret activity",
    )
    client = as_user(world["a"])

    assert client.get(f"/api/tasks/{foreign_task.id}/").status_code == 404
    assert (
        client.patch(f"/api/tasks/{foreign_task.id}/", {"title": "changed"}).status_code
        == 404
    )
    assert client.delete(f"/api/tasks/{foreign_task.id}/").status_code == 404
    assert client.get(f"/api/tasks/{foreign_task.id}/comments/").status_code == 404
    assert (
        client.post(
            f"/api/tasks/{foreign_task.id}/comments/", {"content": "injected"}
        ).status_code
        == 404
    )
    assert client.get(f"/api/tasks/{foreign_task.id}/activity/").status_code == 404
    assert (
        client.patch(
            f"/api/comments/{foreign_comment.id}/", {"content": "changed"}
        ).status_code
        == 404
    )
    assert client.delete(f"/api/comments/{foreign_comment.id}/").status_code == 404
    assert client.get("/api/activity/").json() == []

    foreign_task.refresh_from_db()
    foreign_comment.refresh_from_db()
    assert foreign_task.title == "secret"
    assert foreign_comment.content == "Secret comment"


def test_task_create_rejects_foreign_assignee_and_untrusted_fields(world):
    outsider = User.objects.create_user("outsider@x.com", "Passw0rd!x")
    client = as_user(world["a"])
    response = client.post(
        "/api/tasks/",
        {
            "project": world["proj_a"].id,
            "title": "Bad assignee",
            "assigned_to": outsider.id,
        },
    )
    assert response.status_code == 400
    assert not Task.objects.filter(title="Bad assignee").exists()

    response = client.post(
        "/api/tasks/",
        {
            "project": world["proj_a"].id,
            "title": "No mass assignment",
            "created_by": outsider.id,
            "organization": world["org_b"].id,
        },
    )
    assert response.status_code == 201
    created = Task.objects.get(pk=response.json()["id"])
    assert created.created_by_id == world["a"].id
    assert created.project.organization_id == world["org_a"].id


def test_user_can_only_read_activity_for_their_organizations(world):
    Activity.objects.create(
        organization=world["org_a"],
        actor=world["a"],
        verb="visible",
        message="Visible",
    )
    Activity.objects.create(
        organization=world["org_b"],
        actor=world["b"],
        verb="hidden",
        message="Hidden",
    )
    response = as_user(world["a"]).get("/api/activity/")
    assert response.status_code == 200
    assert [item["message"] for item in response.json()] == ["Visible"]


@pytest.mark.django_db(transaction=True)
def test_task_status_priority_assignment_logs_and_admin_delete(monkeypatch):
    owner = User.objects.create_user("owner@x.com", "Passw0rd!x")
    assignee = User.objects.create_user("assigned@x.com", "Passw0rd!x")
    org = create_organization(owner, "Updates")
    OrganizationMember.objects.create(
        organization=org, user=assignee, role=OrganizationMember.Role.MEMBER
    )
    project = Project.objects.create(organization=org, name="Updates", created_by=owner)
    sent = []
    monkeypatch.setattr(
        "apps.tasks.services.send_assignment_email.delay",
        lambda task_id: sent.append(task_id),
    )
    client = as_user(owner)
    response = client.post("/api/tasks/", {"project": project.id, "title": "Work"})
    assert response.status_code == 201
    task_id = response.json()["id"]

    response = client.patch(
        f"/api/tasks/{task_id}/",
        {"status": "DONE", "priority": "URGENT", "assigned_to": assignee.id},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "DONE"
    assert response.json()["priority"] == "URGENT"
    comment = client.post(f"/api/tasks/{task_id}/comments/", {"content": "Looks good."})
    assert comment.status_code == 201
    events = dict(
        Activity.objects.filter(task_id=task_id).values_list("verb", "message")
    )
    assert {
        "task_created",
        "task_assigned",
        "status_changed",
        "task_completed",
        "priority_changed",
        "comment_added",
    } <= events.keys()
    assert events["status_changed"] == (
        "owner@x.com changed task status from TODO to DONE."
    )
    assert events["comment_added"] == 'owner@x.com commented on "Work".'
    assert sent == [task_id]
    assert client.delete(f"/api/tasks/{task_id}/").status_code == 204
    assert not Task.objects.filter(pk=task_id).exists()


def test_overdue_job_is_scheduled_hourly(settings):
    schedule = settings.CELERY_BEAT_SCHEDULE["overdue-check"]
    assert schedule["task"] == "apps.tasks.jobs.flag_overdue_tasks"
    assert schedule["schedule"] == 3600.0
    assert settings.TIME_ZONE == "Asia/Karachi"
    assert settings.CELERY_TIMEZONE == settings.TIME_ZONE
    assert settings.USE_TZ is True


@pytest.mark.django_db(transaction=True)
def test_overdue_job_excludes_tasks_due_today_and_flags_yesterday(monkeypatch):
    from apps.tasks.jobs import flag_overdue_tasks

    today = date(2026, 10, 4)
    monkeypatch.setattr("apps.tasks.jobs.timezone.localdate", lambda: today)

    owner = User.objects.create_user("date-owner@example.com", "Passw0rd!x")
    organization = create_organization(owner, "Local date overdue")
    project = Project.objects.create(
        organization=organization,
        name="Local date project",
        created_by=owner,
    )
    yesterday_task = Task.objects.create(
        project=project,
        title="Due yesterday",
        created_by=owner,
        due_date=today - timedelta(days=1),
    )
    today_task = Task.objects.create(
        project=project,
        title="Due today",
        created_by=owner,
        due_date=today,
    )

    assert flag_overdue_tasks.run() == 1

    yesterday_task.refresh_from_db()
    today_task.refresh_from_db()
    assert yesterday_task.overdue_notified_at is not None
    assert today_task.overdue_notified_at is None
    assert Activity.objects.filter(task=yesterday_task, verb="task_overdue").exists()
    assert not Activity.objects.filter(task=today_task, verb="task_overdue").exists()


def test_task_comment_and_activity_reads_and_dashboard_statistics(world):
    overdue = Task.objects.create(
        project=world["proj_a"],
        title="Overdue",
        created_by=world["a"],
        assigned_to=world["a"],
        due_date=date.today() - timedelta(days=1),
    )
    done = Task.objects.create(
        project=world["proj_a"],
        title="Done",
        created_by=world["a"],
        assigned_to=world["a"],
        status=Task.Status.DONE,
    )
    client = as_user(world["a"])
    comment_response = client.post(
        f"/api/tasks/{overdue.id}/comments/", {"content": "A note"}
    )
    assert comment_response.status_code == 201
    assert len(client.get(f"/api/tasks/{overdue.id}/comments/").json()) == 1
    assert len(client.get(f"/api/tasks/{overdue.id}/activity/").json()) >= 1

    response = client.get(
        "/api/dashboard/",
        HTTP_X_ORGANIZATION_ID=str(world["org_a"].id),
    )
    assert response.status_code == 200
    assert response.json() == {
        "total_projects": 1,
        "total_tasks": 2,
        "assigned_to_me": 2,
        "completed": 1,
        "overdue": 1,
    }
    assert done.status == Task.Status.DONE
    foreign_org = client.get(
        "/api/dashboard/",
        HTTP_X_ORGANIZATION_ID=str(world["org_b"].id),
    )
    assert foreign_org.status_code == 200
    assert foreign_org.json()["total_tasks"] == 0
    invalid_org = client.get("/api/dashboard/", HTTP_X_ORGANIZATION_ID="invalid")
    assert invalid_org.status_code == 200
    assert invalid_org.json()["total_tasks"] == 0


@pytest.mark.django_db(transaction=True)
def test_assignment_email_and_overdue_jobs(monkeypatch):
    from apps.tasks.jobs import flag_overdue_tasks, send_assignment_email

    assigned = User.objects.create_user("assigned@x.com", "Passw0rd!x")
    owner = User.objects.create_user("owner@x.com", "Passw0rd!x")
    org = create_organization(owner, "Jobs")
    project = Project.objects.create(organization=org, name="Jobs", created_by=owner)
    task = Task.objects.create(
        project=project,
        title="Email me",
        created_by=owner,
        assigned_to=assigned,
        due_date=date.today() - timedelta(days=1),
    )

    email_args = []
    notifications = []
    monkeypatch.setattr(
        "apps.tasks.jobs.send_mail",
        lambda *args: email_args.append(args),
    )
    monkeypatch.setattr(
        "apps.notifications.services.publish_notification",
        lambda *args: notifications.append(args),
    )
    send_assignment_email.run(task.id)
    send_assignment_email.run(999999)
    assert len(email_args) == 1
    assert email_args[0][-1] == [assigned.email]
    assert flag_overdue_tasks.run() == 1
    task.refresh_from_db()
    assert task.overdue_notified_at is not None
    assert Activity.objects.filter(task=task, verb="task_overdue").count() == 1
    assert notifications == [
        (
            org.id,
            "task_overdue",
            'Task "Email me" is overdue.',
            task.id,
            assigned.id,
        )
    ]


@pytest.mark.django_db(transaction=True)
def test_overdue_job_flags_tasks_once_and_does_not_duplicate_notifications(
    monkeypatch,
):
    from apps.tasks.jobs import flag_overdue_tasks

    owner = User.objects.create_user("overdue-owner@x.com", "Passw0rd!x")
    assignee = User.objects.create_user("overdue-assignee@x.com", "Passw0rd!x")
    org = create_organization(owner, "Overdue")
    project = Project.objects.create(organization=org, name="Overdue", created_by=owner)
    task = Task.objects.create(
        project=project,
        title="Late task",
        created_by=owner,
        assigned_to=assignee,
        due_date=date.today() - timedelta(days=1),
    )
    notifications = []
    monkeypatch.setattr(
        "apps.notifications.services.publish_notification",
        lambda *args: notifications.append(args),
    )

    assert flag_overdue_tasks.run() == 1
    task.refresh_from_db()
    assert task.overdue_notified_at is not None
    assert Activity.objects.filter(task=task, verb="task_overdue").count() == 1
    assert len(notifications) == 1

    assert flag_overdue_tasks.run() == 0
    assert Activity.objects.filter(task=task, verb="task_overdue").count() == 1
    assert len(notifications) == 1


@pytest.mark.django_db(transaction=True)
def test_overdue_job_ignores_done_and_future_tasks(monkeypatch):
    from apps.tasks.jobs import flag_overdue_tasks

    owner = User.objects.create_user("ignore-owner@x.com", "Passw0rd!x")
    org = create_organization(owner, "Ignore")
    project = Project.objects.create(organization=org, name="Ignore", created_by=owner)
    done_task = Task.objects.create(
        project=project,
        title="Done task",
        created_by=owner,
        status=Task.Status.DONE,
        due_date=date.today() - timedelta(days=1),
    )
    future_task = Task.objects.create(
        project=project,
        title="Future task",
        created_by=owner,
        due_date=date.today() + timedelta(days=1),
    )
    notifications = []
    monkeypatch.setattr(
        "apps.notifications.services.publish_notification",
        lambda *args: notifications.append(args),
    )

    assert flag_overdue_tasks.run() == 0
    done_task.refresh_from_db()
    future_task.refresh_from_db()
    assert done_task.overdue_notified_at is None
    assert future_task.overdue_notified_at is None
    assert not Activity.objects.filter(verb="task_overdue").exists()
    assert notifications == []
