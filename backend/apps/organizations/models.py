import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def invitation_expiry():
    return timezone.now() + timedelta(days=7)


class Organization(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_orgs"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class OrganizationMember(models.Model):
    class Role(models.TextChoices):
        OWNER = "OWNER"
        ADMIN = "ADMIN"
        MEMBER = "MEMBER"
        VIEWER = "VIEWER"

    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "user"], name="uniq_member_per_org"
            )
        ]
        # uniq index serves (org -> members); this one serves "which orgs does this user belong to" on every request
        indexes = [models.Index(fields=["user"], name="member_user_idx")]


class PendingInvitation(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="pending_invitations"
    )
    email = models.EmailField()
    role = models.CharField(
        max_length=10,
        choices=[
            (OrganizationMember.Role.ADMIN, "Admin"),
            (OrganizationMember.Role.MEMBER, "Member"),
            (OrganizationMember.Role.VIEWER, "Viewer"),
        ],
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sent_organization_invitations",
    )
    token = models.CharField(max_length=64, unique=True, default=secrets.token_urlsafe)
    created_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(default=invitation_expiry)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                "organization",
                Lower("email"),
                name="uniq_invite_org_email",
            )
        ]
        indexes = [
            models.Index(
                fields=["email", "expires_at"],
                name="invite_email_expiry_idx",
            ),
            models.Index(
                fields=["organization", "accepted_at"],
                name="invite_org_pending_idx",
            ),
        ]
