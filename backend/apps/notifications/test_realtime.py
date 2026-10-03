from datetime import timedelta
from urllib.parse import urlencode

import pytest
from asgiref.sync import async_to_sync
from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import override_settings
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import User
from apps.notifications.services import publish_notification
from apps.organizations.models import OrganizationMember
from apps.organizations.services import create_organization
from config.asgi import application


@pytest.fixture
def websocket_headers():
    return [(b"origin", b"http://localhost:3000")]


def websocket_path(user, organization_id, token=None):
    access = token or str(RefreshToken.for_user(user).access_token)
    return f"/ws/notifications/?{urlencode({'organization_id': organization_id})}", [
        "tasklane",
        f"jwt.{access}",
    ]


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_authenticates_jwt_and_delivers_org_notification(websocket_headers):
    user = User.objects.create_user("subscriber@example.com", "StrongPass!234")
    organization = create_organization(user, "Subscribers")
    path, protocols = websocket_path(user, organization.id)
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )

    async def exchange():
        connected, _ = await communicator.connect()
        assert connected
        await get_channel_layer().group_send(
            f"tasklane.org.{organization.id}",
            {
                "type": "notification",
                "organization_id": organization.id,
                "recipient_id": None,
                "notification": {
                    "type": "status_changed",
                    "organization_id": organization.id,
                    "task_id": 41,
                    "message": "A task changed status.",
                },
            },
        )
        message = await communicator.receive_json_from()
        await communicator.disconnect()
        return message

    message = async_to_sync(exchange)()
    assert message["type"] == "status_changed"
    assert message["organization_id"] == organization.id
    assert message["task_id"] == 41
    assert message["message"] == "A task changed status."


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_rejects_missing_and_expired_jwt(websocket_headers):
    user = User.objects.create_user("subscriber@example.com", "StrongPass!234")
    organization = create_organization(user, "Subscribers")

    missing_token = WebsocketCommunicator(
        application,
        f"/ws/notifications/?organization_id={organization.id}",
        headers=websocket_headers,
    )
    connected, code = async_to_sync(missing_token.connect)()
    assert not connected
    assert code == 4401

    expired = RefreshToken.for_user(user).access_token
    expired.set_exp(lifetime=timedelta(seconds=-1))
    path, protocols = websocket_path(user, organization.id, str(expired))
    expired_token = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )
    connected, code = async_to_sync(expired_token.connect)()
    assert not connected
    assert code == 4401

    valid_access = str(RefreshToken.for_user(user).access_token)
    last_signature_character = valid_access[-1]
    tampered_access = valid_access[:-1] + (
        "a" if last_signature_character != "a" else "b"
    )
    tampered_path, tampered_protocols = websocket_path(
        user, organization.id, tampered_access
    )
    tampered_token = WebsocketCommunicator(
        application,
        tampered_path,
        headers=websocket_headers,
        subprotocols=tampered_protocols,
    )
    connected, code = async_to_sync(tampered_token.connect)()
    assert not connected
    assert code == 4401


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_closes_when_access_token_expires(websocket_headers):
    user = User.objects.create_user("subscriber@example.com", "StrongPass!234")
    organization = create_organization(user, "Subscribers")
    access_token = RefreshToken.for_user(user).access_token
    access_token.set_exp(lifetime=timedelta(seconds=2))
    path, protocols = websocket_path(user, organization.id, str(access_token))
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )

    async def connect_until_expired():
        connected, code = await communicator.connect()
        if connected:
            close_event = await communicator.receive_output(timeout=3)
            assert close_event["type"] == "websocket.close"
            assert close_event["code"] == 4401
        else:
            assert code == 4401

    async_to_sync(connect_until_expired)()


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_requires_organization_membership(websocket_headers):
    user = User.objects.create_user("member@example.com", "StrongPass!234")
    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    organization = create_organization(owner, "Private")
    path, protocols = websocket_path(user, organization.id)
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )
    connected, code = async_to_sync(communicator.connect)()
    assert not connected
    assert code == 4403


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_requires_a_valid_organization_parameter(websocket_headers):
    user = User.objects.create_user("member@example.com", "StrongPass!234")
    path, protocols = websocket_path(user, "not-an-id")
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )
    connected, code = async_to_sync(communicator.connect)()
    assert not connected
    assert code == 4400


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_user_notification_is_only_delivered_to_intended_recipient(websocket_headers):
    recipient = User.objects.create_user("recipient@example.com", "StrongPass!234")
    other = User.objects.create_user("other@example.com", "StrongPass!234")
    organization = create_organization(recipient, "Recipient org")
    path, protocols = websocket_path(recipient, organization.id)
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )

    async def exchange():
        connected, _ = await communicator.connect()
        assert connected
        layer = get_channel_layer()
        await layer.group_send(
            f"tasklane.user.{recipient.id}",
            {
                "type": "notification",
                "organization_id": organization.id,
                "recipient_id": other.id,
                "notification": {"type": "task_assigned", "task_id": 7},
            },
        )
        assert await communicator.receive_nothing(timeout=0.05)
        await layer.group_send(
            f"tasklane.user.{recipient.id}",
            {
                "type": "notification",
                "organization_id": organization.id,
                "recipient_id": recipient.id,
                "notification": {
                    "type": "task_assigned",
                    "organization_id": organization.id,
                    "task_id": 7,
                    "message": "You were assigned a task.",
                },
            },
        )
        message = await communicator.receive_json_from()
        await communicator.disconnect()
        return message

    message = async_to_sync(exchange)()
    assert message["type"] == "task_assigned"
    assert message["task_id"] == 7
    async_to_sync(communicator.disconnect)()


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_websocket_closes_after_organization_membership_is_revoked(websocket_headers):
    user = User.objects.create_user("subscriber@example.com", "StrongPass!234")
    organization = create_organization(user, "Subscribers")
    path, protocols = websocket_path(user, organization.id)
    communicator = WebsocketCommunicator(
        application,
        path,
        headers=websocket_headers,
        subprotocols=protocols,
    )

    async def connect_and_revoke():
        connected, _ = await communicator.connect()
        assert connected
        await sync_to_async(
            OrganizationMember.objects.filter(
                user=user, organization=organization
            ).delete,
            thread_sensitive=True,
        )()
        await get_channel_layer().group_send(
            f"tasklane.org.{organization.id}",
            {
                "type": "notification",
                "organization_id": organization.id,
                "recipient_id": None,
                "notification": {"type": "status_changed"},
            },
        )
        close_event = await communicator.receive_output()
        assert close_event["type"] == "websocket.close"
        assert close_event["code"] == 4403

    async_to_sync(connect_and_revoke)()


@pytest.mark.django_db(transaction=True)
@override_settings(
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
)
def test_task_services_publish_assignment_comment_and_status_events(monkeypatch):
    from apps.organizations.models import OrganizationMember
    from apps.projects.models import Project
    from apps.tasks.models import Task
    from apps.tasks.services import add_comment, create_task, update_task

    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    assignee = User.objects.create_user("assignee@example.com", "StrongPass!234")
    organization = create_organization(owner, "Notifications")
    OrganizationMember.objects.create(
        organization=organization, user=assignee, role=OrganizationMember.Role.MEMBER
    )
    project = Project.objects.create(
        organization=organization, name="Board", created_by=owner
    )
    published = []
    monkeypatch.setattr(
        "apps.tasks.services.publish_notification",
        lambda *args, **kwargs: published.append((args, kwargs)),
    )
    monkeypatch.setattr(
        "apps.tasks.services.send_assignment_email.delay", lambda _id: None
    )

    task = create_task(
        owner,
        {"project": project, "title": "Notify", "assigned_to": assignee},
    )
    update_task(owner, task, {"status": Task.Status.IN_PROGRESS})
    add_comment(owner, task, "A comment")

    assert [event[0][1] for event in published] == [
        "task_assigned",
        "status_changed",
        "comment_added",
    ]
    assert published[0][0][4] == assignee.id
    assert all(event[0][0] == organization.id for event in published)


def test_notification_publisher_routes_and_shapes_user_events(monkeypatch):
    sent = []

    class RecordingLayer:
        async def group_send(self, group, event):
            sent.append((group, event))

    monkeypatch.setattr(
        "apps.notifications.services.get_channel_layer", lambda: RecordingLayer()
    )
    publish_notification(
        organization_id=12,
        event_type="task_assigned",
        message="You were assigned a task.",
        task_id=34,
        recipient_id=56,
    )

    assert len(sent) == 1
    group, event = sent[0]
    assert group == "tasklane.user.56"
    assert event["type"] == "notification"
    assert event["organization_id"] == 12
    assert event["recipient_id"] == 56
    assert event["notification"]["type"] == "task_assigned"
    assert event["notification"]["organization_id"] == 12
    assert event["notification"]["task_id"] == 34
    assert event["notification"]["message"] == "You were assigned a task."
    assert event["notification"]["id"]
    assert event["notification"]["created_at"]


def test_notification_publisher_fails_if_no_channel_layer():
    with override_settings(CHANNEL_LAYERS={}):
        with pytest.raises(RuntimeError, match="channel layer is not configured"):
            publish_notification(1, "comment_added", "Commented", task_id=1)
