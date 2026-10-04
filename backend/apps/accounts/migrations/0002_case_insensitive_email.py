from collections import defaultdict

from django.db import migrations, models
from django.db.models.functions import Lower


def ensure_no_email_collisions(emails):
    normalized_emails = defaultdict(list)
    for email in emails:
        normalized_emails[email.strip().lower()].append(email)

    collisions = [values for values in normalized_emails.values() if len(values) > 1]
    if collisions:
        details = "; ".join(", ".join(sorted(values)) for values in collisions)
        raise RuntimeError(
            "Cannot lowercase User.email because case-insensitive collisions were "
            f"found: {details}. Resolve these accounts before retrying the migration."
        )


def normalize_existing_emails(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    users = list(User.objects.values_list("pk", "email"))
    ensure_no_email_collisions(email for _, email in users)

    for user_id, email in users:
        normalized_email = email.strip().lower()
        if email != normalized_email:
            User.objects.filter(pk=user_id).update(email=normalized_email)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            normalize_existing_emails,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                Lower("email"), name="user_email_ci_unique"
            ),
        ),
    ]
