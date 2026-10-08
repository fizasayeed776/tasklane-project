from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.notifications.services import prune_read_notifications
from apps.organizations.models import OrganizationMember
from apps.organizations.services import create_organization
from apps.projects.models import Project
from apps.tasks.models import Task


@pytest.fixture
def notification_world():
    owner = User.objects.create_user("notify-owner@example.com", "StrongPass!234")
    member = User.objects.create_user("notify-member@example.com", "StrongPass!234")
    other = User.objects.create_user("notify-other@example.com", "StrongPass!234")
    organization = create_organization(owner, "Notifications")
    OrganizationMember.objects.create(
        organization=organization,
        user=member,
        role=OrganizationMember.Role.MEMBER,
    )
    other_organization = create_organization(other, "Other")
    project = Project.objects.create(
        organization=organization,
        name="Board",
        created_by=owner,
    )
    task = Task.objects.create(
        project=project,
        title="Notify me",
        created_by=owner,
        assigned_to=member,
    )
    return {
        "owner": owner,
        "member": member,
        "other": other,
        "organization": organization,
        "other_organization": other_organization,
        "task": task,
    }


def make_notification(user, organization, task=None, **kwargs):
    return Notification.objects.create(
        recipient=user,
        organization=organization,
        task=task,
        event_type=kwargs.pop("event_type", "comment_added"),
        message=kwargs.pop("message", "A teammate commented."),
        **kwargs,
    )


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.django_db
def test_task_events_persist_to_the_right_recipients_except_the_actor(
    notification_world,
):
    from apps.tasks.services import add_comment, create_task, update_task

    world = notification_world
    owner = world["owner"]
    member = world["member"]
    task = create_task(
        owner,
        {
            "project": world["task"].project,
            "title": "Assigned",
            "assigned_to": member,
        },
    )
    update_task(owner, task, {"status": Task.Status.IN_PROGRESS})
    add_comment(member, task, "A comment")

    rows = list(
        Notification.objects.filter(task=task).values_list("event_type", "recipient_id")
    )
    assert set(rows) == {
        ("task_assigned", member.id),
        ("status_changed", member.id),
        ("comment_added", owner.id),
    }
    assert (
        not Notification.objects.filter(task=task, recipient=owner)
        .filter(event_type__in=["task_assigned", "status_changed"])
        .exists()
    )
    assert (
        not Notification.objects.filter(task=task, recipient=member)
        .filter(event_type="comment_added")
        .exists()
    )


@pytest.mark.django_db
def test_notification_list_unread_count_and_read_actions(notification_world):
    world = notification_world
    unread = make_notification(world["member"], world["organization"], world["task"])
    read = make_notification(
        world["member"],
        world["organization"],
        read_at=timezone.now(),
        message="Already read.",
    )
    client = client_for(world["member"])

    response = client.get("/api/notifications/")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["results"]] == [read.id, unread.id]
    unread_payload = response.json()["results"][1]
    assert unread_payload == {
        "id": unread.id,
        "event_type": "comment_added",
        "message": "A teammate commented.",
        "organization": {
            "id": world["organization"].id,
            "name": world["organization"].name,
        },
        "task": world["task"].id,
        "read": False,
        "read_at": None,
        "created_at": unread_payload["created_at"],
    }
    assert [
        item["id"]
        for item in client.get("/api/notifications/?unread=true").json()["results"]
    ] == [unread.id]
    assert client.get("/api/notifications/unread-count/").json() == {"count": 1}

    marked = client.post(f"/api/notifications/{unread.id}/read/")
    assert marked.status_code == 200
    assert marked.json()["read"] is True
    assert client.post(f"/api/notifications/{unread.id}/read/").json()["read"] is True
    assert client.get("/api/notifications/unread-count/").json() == {"count": 0}


@pytest.mark.django_db
def test_mark_all_read_can_be_limited_to_a_membership(notification_world):
    world = notification_world
    own = make_notification(world["member"], world["organization"], world["task"])
    other = make_notification(world["member"], world["other_organization"])
    OrganizationMember.objects.create(
        organization=world["other_organization"],
        user=world["member"],
        role=OrganizationMember.Role.MEMBER,
    )
    client = client_for(world["member"])

    response = client.post(
        f"/api/notifications/mark-all-read/?organization={world['organization'].id}"
    )
    assert response.status_code == 200
    assert response.json() == {"updated": 1}
    own.refresh_from_db()
    other.refresh_from_db()
    assert own.read_at is not None
    assert other.read_at is None
    assert (
        client.post("/api/notifications/mark-all-read/?organization=999999").status_code
        == 404
    )
    assert client.post("/api/notifications/mark-all-read/").json() == {"updated": 1}


@pytest.mark.django_db
def test_notification_idor_cross_organization_and_left_membership_are_hidden(
    notification_world,
):
    world = notification_world
    row = make_notification(world["member"], world["organization"], world["task"])
    foreign_row = make_notification(
        world["other"],
        world["other_organization"],
        event_type="status_changed",
    )
    member_client = client_for(world["member"])
    other_client = client_for(world["other"])

    assert other_client.post(f"/api/notifications/{row.id}/read/").status_code == 404
    assert foreign_row.id not in {
        item["id"]
        for item in member_client.get("/api/notifications/").json()["results"]
    }
    OrganizationMember.objects.filter(
        user=world["member"], organization=world["organization"]
    ).delete()
    assert member_client.get("/api/notifications/").json()["results"] == []
    assert member_client.post(f"/api/notifications/{row.id}/read/").status_code == 404


@pytest.mark.django_db
def test_notification_is_retained_after_task_deletion(notification_world):
    world = notification_world
    row = make_notification(world["member"], world["organization"], world["task"])
    world["task"].delete()

    row.refresh_from_db()
    assert row.task_id is None
    response = client_for(world["member"]).get("/api/notifications/")
    assert response.json()["results"][0]["task"] is None


@pytest.mark.django_db
def test_notification_list_is_paginated(notification_world):
    world = notification_world
    rows = [
        make_notification(
            world["member"],
            world["organization"],
            message=f"Notification {index}",
        )
        for index in range(51)
    ]
    response = client_for(world["member"]).get("/api/notifications/")

    assert response.status_code == 200
    assert response.json()["count"] == 51
    assert len(response.json()["results"]) == 50
    assert response.json()["next"].endswith("page=2")
    assert response.json()["results"][0]["id"] == rows[-1].id


@pytest.mark.django_db(transaction=True)
def test_notification_requests_do_not_consume_account_throttle(notification_world):
    world = notification_world
    cache.clear()
    try:
        client = client_for(world["member"])

        responses = [client.get("/api/notifications/unread-count/") for _ in range(15)]
        assert all(response.status_code == 200 for response in responses)

        password_response = client.post(
            "/api/auth/password/change/",
            {
                "old_password": "StrongPass!234",
                "new_password": "AnotherStrong!567",
            },
            format="json",
        )
        assert password_response.status_code == 200
    finally:
        cache.clear()


@pytest.mark.django_db
def test_notification_api_requires_auth_and_schema_documents_read_endpoints():
    client = APIClient()
    assert client.get("/api/notifications/").status_code == 401
    schema = client.get("/api/schema/?format=json").json()
    paths = schema["paths"]
    assert {
        "200",
        "401",
    }.issubset(paths["/api/notifications/unread-count/"]["get"]["responses"])
    assert {
        "200",
        "401",
        "404",
    }.issubset(paths["/api/notifications/{id}/read/"]["post"]["responses"])
    assert "unread" in {
        parameter["name"]
        for parameter in paths["/api/notifications/"]["get"]["parameters"]
    }
    assert "organization" in {
        parameter["name"]
        for parameter in paths["/api/notifications/mark-all-read/"]["post"][
            "parameters"
        ]
    }


@pytest.mark.django_db
def test_prune_read_notifications_removes_only_rows_older_than_sixty_days(
    notification_world,
):
    world = notification_world
    old_read = make_notification(
        world["member"],
        world["organization"],
        read_at=timezone.now() - timedelta(days=61),
    )
    recent_read = make_notification(
        world["member"],
        world["organization"],
        read_at=timezone.now() - timedelta(days=59),
    )
    unread = make_notification(world["member"], world["organization"])

    assert prune_read_notifications() == 1
    assert not Notification.objects.filter(pk=old_read.pk).exists()
    assert Notification.objects.filter(pk=recent_read.pk).exists()
    assert Notification.objects.filter(pk=unread.pk).exists()
