from django.urls import path

from . import views as v

urlpatterns = [
    path("register/", v.RegisterView.as_view()),
    path("login/", v.LoginView.as_view()),
    path("refresh/", v.RefreshView.as_view()),
    path("logout/", v.LogoutView.as_view()),
    path("me/", v.MeView.as_view()),
    path("password/change/", v.ChangePasswordView.as_view()),
    path("password/forgot/", v.ForgotPasswordView.as_view()),
    path("password/reset/", v.ResetPasswordView.as_view()),
]
