from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmailRequest(InputModel):
    email: EmailStr = Field(max_length=254)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class LoginRequest(EmailRequest):
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(EmailRequest):
    password: str = Field(min_length=12, max_length=128)
    full_name: str = Field(min_length=1, max_length=100)
    role: Literal["student", "business"] = "student"
    newsletter_opt_in: bool = False

    @field_validator("full_name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class TokenRequest(InputModel):
    token: str = Field(min_length=32, max_length=128)


class ResetPasswordRequest(TokenRequest):
    new_password: str = Field(min_length=12, max_length=128)


class PreferencesRequest(InputModel):
    newsletter_opt_in: bool


class UserResponse(BaseModel):
    id: int | str
    email: str
    full_name: str
    role: Literal["student", "business", "admin"]
    email_verified: bool
    newsletter_opt_in: bool


class MessageResponse(BaseModel):
    message: str


class MailResponse(MessageResponse):
    delivery: Literal["preview", "queued"]


class CampaignRequest(InputModel):
    subject: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=10000)

    @field_validator("subject", "text")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Must not be blank")
        return value.strip()

    @field_validator("subject")
    @classmethod
    def single_line(cls, value):
        if "\r" in value or "\n" in value:
            raise ValueError("Subject must be a single line")
        return value
