"""Tests for management commands: seed_demo and prune_stale_data."""

from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.organizations.models import (
    Organization,
    OrganizationMember,
    PendingInvitation,
)
from apps.organizations.services import create_organization
from apps.tasks.models import Activity, Comment, Task

pytestmark = pytest.mark.django_db


# ── seed_demo ─────────────────────────────────────────────────────────────────


def _run_seed(password="DemoPass!234", force=False):
    out = StringIO()
    kwargs = {"password": password, "stdout": out, "force": force}
    call_command("seed_demo", **kwargs)
    return out.getvalue()


@override_settings(DEBUG=True)
def test_seed_demo_creates_expected_roles():
    _run_seed()

    demo_org = Organization.objects.get(name="Demo Org")
    assert demo_org is not None

    def role_of(email):
        user = User.objects.get(email=email)
        return OrganizationMember.objects.get(organization=demo_org, user=user).role

    assert role_of("owner@demo.test") == OrganizationMember.Role.OWNER
    assert role_of("admin@demo.test") == OrganizationMember.Role.ADMIN
    assert role_of("member@demo.test") == OrganizationMember.Role.MEMBER
    assert role_of("viewer@demo.test") == OrganizationMember.Role.VIEWER

    # Outsider is NOT a member of Demo Org
    outsider = User.objects.get(email="outsider@demo.test")
    assert not OrganizationMember.objects.filter(
        organization=demo_org, user=outsider
    ).exists()

    # Outsider owns Other Org
    other_org = Organization.objects.get(name="Other Org")
    assert other_org.owner == outsider

    # Tasks created
    assert Task.objects.filter(project__organization=demo_org).count() >= 8

    # Activity entries exist (created via services)
    assert Activity.objects.filter(organization=demo_org).exists()


@override_settings(DEBUG=True)
def test_seed_demo_is_idempotent():
    _run_seed(force=True)

    demo_org = Organization.objects.get(name="Demo Org")
    first_counts = {
        "users": User.objects.count(),
        "organizations": Organization.objects.count(),
        "projects": demo_org.projects.count(),
        "tasks": Task.objects.filter(project__organization=demo_org).count(),
        "comments": Comment.objects.filter(
            task__project__organization=demo_org
        ).count(),
        "activities": Activity.objects.filter(organization=demo_org).count(),
    }
    assert first_counts["organizations"] == 2
    assert first_counts["projects"] == 2
    assert first_counts["tasks"] == 8
    assert first_counts["comments"] == 3

    _run_seed(force=True)

    demo_org.refresh_from_db()
    second_counts = {
        "users": User.objects.count(),
        "organizations": Organization.objects.count(),
        "projects": demo_org.projects.count(),
        "tasks": Task.objects.filter(project__organization=demo_org).count(),
        "comments": Comment.objects.filter(
            task__project__organization=demo_org
        ).count(),
        "activities": Activity.objects.filter(organization=demo_org).count(),
    }
    assert second_counts == first_counts


@override_settings(DEBUG=False)
def test_seed_demo_refuses_without_force_when_debug_false():
    with pytest.raises(CommandError, match="DEBUG=False"):
        _run_seed()


@override_settings(DEBUG=False)
def test_seed_demo_runs_with_force_when_debug_false():
    out = _run_seed(force=True)
    assert "seed_demo complete" in out
    assert Organization.objects.filter(name="Demo Org").exists()


# ── prune_stale_data ──────────────────────────────────────────────────────────


def _run_prune(*args, **kwargs):
    out = StringIO()
    kwargs["stdout"] = out
    call_command("prune_stale_data", *args, **kwargs)
    return out.getvalue()


def _old(days=31):
    return timezone.now() - timedelta(days=days)


@pytest.fixture
def owner_and_org():
    owner = User.objects.create_user("owner@example.com", "StrongPass!234")
    org = create_organization(owner, "Test Org")
    return owner, org


def _stale_invitation(org, owner, email="stale@example.com", accepted_days_ago=35):
    """Create a PendingInvitation that is already accepted and older than threshold."""
    inv = PendingInvitation.objects.create(
        organization=org,
        email=email,
        role=OrganizationMember.Role.MEMBER,
        invited_by=owner,
        accepted_at=_old(accepted_days_ago),
        expires_at=timezone.now() + timedelta(days=7),
    )
    return inv


def _expired_invitation(org, owner, email="expired@example.com", expired_days_ago=35):
    """Create a PendingInvitation that expired more than threshold days ago."""
    inv = PendingInvitation.objects.create(
        organization=org,
        email=email,
        role=OrganizationMember.Role.MEMBER,
        invited_by=owner,
        accepted_at=None,
        expires_at=_old(expired_days_ago),
    )
    return inv


def test_prune_dry_run_deletes_nothing(owner_and_org):
    owner, org = owner_and_org
    inv = _stale_invitation(org, owner)

    output = _run_prune()

    assert "DRY RUN" in output
    # Invitation must still exist
    assert PendingInvitation.objects.filter(pk=inv.pk).exists()


def test_prune_yes_deletes_accepted_and_expired_invitations(owner_and_org):
    owner, org = owner_and_org
    accepted = _stale_invitation(org, owner, email="a@example.com")
    expired = _expired_invitation(org, owner, email="b@example.com")
    # Recent invitation must be kept
    recent = PendingInvitation.objects.create(
        organization=org,
        email="recent@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=owner,
        expires_at=timezone.now() + timedelta(days=7),
    )

    output = _run_prune("--yes")

    assert not PendingInvitation.objects.filter(pk=accepted.pk).exists()
    assert not PendingInvitation.objects.filter(pk=expired.pk).exists()
    assert PendingInvitation.objects.filter(pk=recent.pk).exists()
    assert "Deleted" in output


def test_prune_users_dry_run_deletes_nothing(owner_and_org):
    owner, org = owner_and_org
    orphan = User.objects.create_user("orphan@example.com", "StrongPass!234")
    # Make the user old
    User.objects.filter(pk=orphan.pk).update(date_joined=_old(60))

    output = _run_prune("--users")
    assert User.objects.filter(pk=orphan.pk).exists()
    assert "Would delete" in output


def test_prune_users_yes_deletes_eligible_orphan(owner_and_org):
    owner, org = owner_and_org
    orphan = User.objects.create_user("orphan@example.com", "StrongPass!234")
    User.objects.filter(pk=orphan.pk).update(date_joined=_old(60))

    _run_prune("--yes", "--users")
    assert not User.objects.filter(pk=orphan.pk).exists()


def test_prune_never_deletes_staff_user(owner_and_org):
    owner, org = owner_and_org
    staff = User.objects.create_user("staff@example.com", "StrongPass!234")
    staff.is_staff = True
    staff.save(update_fields=["is_staff"])
    User.objects.filter(pk=staff.pk).update(date_joined=_old(60))

    _run_prune("--yes", "--users")
    assert User.objects.filter(pk=staff.pk).exists()


def test_prune_never_deletes_org_owner(owner_and_org):
    owner, org = owner_and_org
    User.objects.filter(pk=owner.pk).update(date_joined=_old(60))

    _run_prune("--yes", "--users")
    # Owner is protected (owns an org)
    assert User.objects.filter(pk=owner.pk).exists()


def test_prune_never_deletes_user_with_membership(owner_and_org):
    owner, org = owner_and_org
    member_user = User.objects.create_user("member@example.com", "StrongPass!234")
    OrganizationMember.objects.create(
        organization=org, user=member_user, role=OrganizationMember.Role.MEMBER
    )
    User.objects.filter(pk=member_user.pk).update(date_joined=_old(60))

    _run_prune("--yes", "--users")
    assert User.objects.filter(pk=member_user.pk).exists()


def test_prune_never_deletes_user_who_authored_comment(owner_and_org):
    from apps.projects.models import Project

    owner, org = owner_and_org
    commenter = User.objects.create_user("commenter@example.com", "StrongPass!234")
    # Give them a membership to create task/comment, then remove membership
    OrganizationMember.objects.create(
        organization=org, user=commenter, role=OrganizationMember.Role.MEMBER
    )
    project = Project.objects.create(
        organization=org, name="Test Project", created_by=owner
    )
    task = Task.objects.create(
        project=project,
        title="Some task",
        created_by=owner,
    )
    Comment.objects.create(task=task, user=commenter, content="A comment")
    # Remove membership so user becomes "orphaned"
    OrganizationMember.objects.filter(organization=org, user=commenter).delete()
    User.objects.filter(pk=commenter.pk).update(date_joined=_old(60))

    _run_prune("--yes", "--users")
    assert User.objects.filter(pk=commenter.pk).exists()


def test_prune_keeps_recent_users(owner_and_org):
    owner, org = owner_and_org
    recent = User.objects.create_user("recent@example.com", "StrongPass!234")
    # date_joined is auto-set to now; do NOT backdate

    _run_prune("--yes", "--users")
    assert User.objects.filter(pk=recent.pk).exists()


# ── prune_stale_data Celery Beat task (optional auto-cleanup of invitations) ──


def test_prune_stale_invitations_celery_task(owner_and_org):
    """The celery task deletes only accepted/expired invitations older than 30 days."""
    owner, org = owner_and_org
    accepted = _stale_invitation(
        org, owner, email="a@example.com", accepted_days_ago=35
    )
    expired = _expired_invitation(
        org, owner, email="b@example.com", expired_days_ago=35
    )
    recent = PendingInvitation.objects.create(
        organization=org,
        email="fresh@example.com",
        role=OrganizationMember.Role.MEMBER,
        invited_by=owner,
        expires_at=timezone.now() + timedelta(days=7),
    )

    from apps.organizations.jobs import prune_stale_invitations

    deleted_count = prune_stale_invitations()

    assert deleted_count >= 2
    assert not PendingInvitation.objects.filter(pk=accepted.pk).exists()
    assert not PendingInvitation.objects.filter(pk=expired.pk).exists()
    assert PendingInvitation.objects.filter(pk=recent.pk).exists()
