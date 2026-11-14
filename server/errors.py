class ResearchError(Exception):
    def __init__(self, code, message, field=None, retryable=False, status=422):
        super().__init__(message)
        self.status = status
        self.payload = {"code": code, "message": message, "field": field, "retryable": retryable}
