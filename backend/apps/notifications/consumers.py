import asyncio
import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.organizations.models import OrganizationMember


@database_sync_to_async
def _is_organization_member(user_id, organization_id):
    return OrganizationMember.objects.filter(
        user_id=user_id, organization_id=organization_id
    ).exists()


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return

        query = self.scope.get("query_string", b"").decode("utf-8", errors="replace")
        parameters = parse_qs(query)
        try:
            organization_id = int(parameters["organization_id"][-1])
        except (KeyError, TypeError, ValueError):
            await self.close(code=4400)
            return

        if not await _is_organization_member(user.id, organization_id):
            await self.close(code=4403)
            return

        self.organization_id = organization_id
        self.organization_group = f"tasklane.org.{organization_id}"
        self.user_group = f"tasklane.user.{user.id}"
        await self.channel_layer.group_add(self.organization_group, self.channel_name)
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        self.expiry_task = asyncio.create_task(self._close_when_token_expires())
        await self.accept(subprotocol="tasklane")

    async def disconnect(self, close_code):
        expiry_task = getattr(self, "expiry_task", None)
        if expiry_task and expiry_task is not asyncio.current_task():
            expiry_task.cancel()
        if hasattr(self, "organization_group"):
            await self.channel_layer.group_discard(
                self.organization_group, self.channel_name
            )
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

    async def notification(self, event):
        if not await _is_organization_member(
            self.scope["user"].id, self.organization_id
        ):
            await self.close(code=4403)
            return
        if event["organization_id"] != self.organization_id:
            return
        if time.time() >= self.scope["jwt_exp"]:
            await self.close(code=4401)
            return
        recipient_id = event.get("recipient_id")
        if recipient_id is not None and recipient_id != self.scope["user"].id:
            return
        await self.send_json(event["notification"])

    async def _close_when_token_expires(self):
        delay = max(self.scope["jwt_exp"] - time.time(), 0)
        await asyncio.sleep(delay)
        await self.close(code=4401)
