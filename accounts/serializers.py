def user_to_dict(user) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "is_staff": user.is_staff,
    }
