# adapters

Concrete implementations of the ports and the delivery mechanisms: the FastAPI API
(driving adapter), SQLAlchemy persistence, the OS keychain, database introspection,
and AI providers. Only this layer knows about frameworks and external systems.
