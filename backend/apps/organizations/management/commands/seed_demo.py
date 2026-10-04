"""seed_demo management command.

Creates a demo organization with four accounts demonstrating every role, two
projects with 8 tasks in various statuses and priorities, comments, and
activity entries — all produced through the normal service layer.

Usage:
    python manage.py seed_demo              # DEBUG=True environments
    python manage.py seed_demo --force      # any environment
    python manage.py seed_demo --password MyPass!123
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.organizations.models import Organization, OrganizationMember
from apps.organizations.services import create_organization
from apps.projects.services import create_project
from apps.tasks.services import add_comment, create_task, update_task

R = OrganizationMember.Role

DEMO_ACCOUNTS = [
    # (email, first_name, role-in-Demo Org)
    ("owner@demo.test", "Demo Owner", R.OWNER),
    ("admin@demo.test", "Demo Admin", R.ADMIN),
    ("member@demo.test", "Demo Member", R.MEMBER),
    ("viewer@demo.test", "Demo Viewer", R.VIEWER),
]

OTHER_ORG_ACCOUNTS = [
    ("outsider@demo.test", "Demo Outsider"),
]


def _get_or_create_user(email, first_name, password):
    """Return (user, created) – never overwrites an existing password."""
    user = User.objects.filter(email=email).first()
    if user:
        return user, False
    user = User.objects.create_user(email, password, first_name=first_name)
    return user, True


def _get_or_create_org(owner, name):
    org = Organization.objects.filter(name=name, owner=owner).first()
    if org:
        return org, False
    org = create_organization(owner, name)
    return org, True


def _ensure_membership(org, user, role):
    membership, created = OrganizationMember.objects.get_or_create(
        organization=org, user=user, defaults={"role": role}
    )
    if not created and membership.role != role:
        membership.role = role
        membership.save(update_fields=["role"])
    return membership


def _get_or_create_project(owner, org, name):
    from apps.projects.models import Project

    existing = Project.objects.filter(organization=org, name=name).first()
    if existing:
        return existing, False
    proj = create_project(owner, {"organization_id": org.id, "name": name})
    return proj, True


class Command(BaseCommand):
    help = "Seed a Demo organization with sample data for development / demo purposes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            default="DemoPass!234",
            help="Password for all demo accounts (default: DemoPass!234)",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Allow execution even when DEBUG=False.",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "seed_demo refuses to run when DEBUG=False.  "
                "Pass --force to override (not recommended in production)."
            )

        password = options["password"]

        with transaction.atomic():
            # ── accounts ──────────────────────────────────────────────────────
            users = {}
            for email, first_name, _ in DEMO_ACCOUNTS:
                user, created = _get_or_create_user(email, first_name, password)
                users[email] = user

            outsider, _ = _get_or_create_user(
                OTHER_ORG_ACCOUNTS[0][0],
                OTHER_ORG_ACCOUNTS[0][1],
                password,
            )

            owner = users["owner@demo.test"]
            admin = users["admin@demo.test"]
            member = users["member@demo.test"]
            viewer = users["viewer@demo.test"]

            # ── Demo Org ───────────────────────────────────────────────────────
            demo_org, _ = _get_or_create_org(owner, "Demo Org")

            # Owner membership is created by create_organization; add the rest.
            _ensure_membership(demo_org, admin, R.ADMIN)
            _ensure_membership(demo_org, member, R.MEMBER)
            _ensure_membership(demo_org, viewer, R.VIEWER)

            # ── Other Org (for cross-org isolation demo) ───────────────────────
            other_org, _ = _get_or_create_org(outsider, "Other Org")

            # ── Projects ───────────────────────────────────────────────────────
            alpha, alpha_new = _get_or_create_project(owner, demo_org, "Alpha Sprint")
            backend, backend_new = _get_or_create_project(
                owner, demo_org, "Backend Hardening"
            )

            from apps.tasks.models import Task

            # ── Tasks for Alpha Sprint ─────────────────────────────────────────
            def _task_exists(project, title):
                return Task.objects.filter(project=project, title=title).exists()

            alpha_tasks_spec = [
                # (title, priority, status, assigned_to)
                (
                    "Design new onboarding flow",
                    Task.Priority.HIGH,
                    Task.Status.TODO,
                    member,
                ),
                (
                    "Set up CI pipeline",
                    Task.Priority.URGENT,
                    Task.Status.IN_PROGRESS,
                    admin,
                ),
                (
                    "Write API documentation",
                    Task.Priority.MEDIUM,
                    Task.Status.REVIEW,
                    member,
                ),
                (
                    "Deploy to staging",
                    Task.Priority.HIGH,
                    Task.Status.DONE,
                    admin,
                ),
                (
                    "Review pull requests",
                    Task.Priority.LOW,
                    Task.Status.TODO,
                    None,
                ),
            ]

            backend_tasks_spec = [
                (
                    "Audit authentication middleware",
                    Task.Priority.URGENT,
                    Task.Status.IN_PROGRESS,
                    admin,
                ),
                (
                    "Add rate limiting to auth endpoints",
                    Task.Priority.HIGH,
                    Task.Status.TODO,
                    member,
                ),
                (
                    "Rotate production secrets",
                    Task.Priority.URGENT,
                    Task.Status.DONE,
                    owner,
                ),
            ]

            alpha_tasks = {}
            for title, priority, status, assignee in alpha_tasks_spec:
                if _task_exists(alpha, title):
                    task = Task.objects.get(project=alpha, title=title)
                else:
                    task = create_task(
                        owner,
                        {
                            "project": alpha,
                            "title": title,
                            "priority": priority,
                            "assigned_to": assignee,
                        },
                    )
                    if task.status != status:
                        update_task(assignee or owner, task, {"status": status})
                alpha_tasks[title] = task

            backend_tasks = {}
            for title, priority, status, assignee in backend_tasks_spec:
                if _task_exists(backend, title):
                    task = Task.objects.get(project=backend, title=title)
                else:
                    task = create_task(
                        owner,
                        {
                            "project": backend,
                            "title": title,
                            "priority": priority,
                            "assigned_to": assignee,
                        },
                    )
                    if task.status != status:
                        update_task(assignee or owner, task, {"status": status})
                backend_tasks[title] = task

            # ── Comments ───────────────────────────────────────────────────────
            from apps.tasks.models import Comment

            def _comment_exists(task, user, content_prefix):
                return Comment.objects.filter(
                    task=task, user=user, content__startswith=content_prefix
                ).exists()

            _COMMENT_PAIRS = [
                (
                    alpha_tasks["Design new onboarding flow"],
                    member,
                    "Wireframes are attached in Figma — ",
                    "Wireframes are attached in Figma — please review before Thursday.",
                ),
                (
                    alpha_tasks["Design new onboarding flow"],
                    admin,
                    "Looks good overall. ",
                    "Looks good overall. Can we add a skip step?",
                ),
                (
                    backend_tasks["Audit authentication middleware"],
                    admin,
                    "Found two places where the token expiry ",
                    "Found two places where the token expiry is not checked. Patching now.",
                ),
            ]

            for task, user, prefix, full in _COMMENT_PAIRS:
                if not _comment_exists(task, user, prefix):
                    add_comment(user, task, full)

        # ── Summary table ──────────────────────────────────────────────────────
        self.stdout.write("\n")
        self.stdout.write(self.style.SUCCESS("─" * 62))
        self.stdout.write(
            self.style.SUCCESS(f"  seed_demo complete  •  password: {password}")
        )
        self.stdout.write(self.style.SUCCESS("─" * 62))
        self.stdout.write(f"  {'Email':<30} {'Name':<18} {'Role'}")
        self.stdout.write("  " + "─" * 58)
        for email, first_name, role in DEMO_ACCOUNTS:
            self.stdout.write(f"  {email:<30} {first_name:<18} {role}")
        self.stdout.write("  " + "─" * 58)
        self.stdout.write(
            f"  {'outsider@demo.test':<30} {'Demo Outsider':<18} "
            f"OWNER of 'Other Org'"
        )
        self.stdout.write(self.style.SUCCESS("─" * 62))
        self.stdout.write("")
