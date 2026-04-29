from src.job_template import build_job_spec


def test_runtime_class_is_gvisor():
    spec = build_job_spec(
        execution_id="abc-1234",
        user_id="discord-user-1",
        image="sandbox-base:test",
        wall_clock_seconds=300,
        cpu_limit="2",
        memory_limit="2Gi",
        env={},
        namespace="discord-article-bot",
    )
    assert spec["spec"]["template"]["spec"]["runtimeClassName"] == "gvisor"


def test_no_sa_token_mounted():
    spec = build_job_spec(
        execution_id="abc-1234", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["template"]["spec"]["automountServiceAccountToken"] is False
    assert spec["spec"]["template"]["spec"]["serviceAccountName"] == "sandbox-sa"


def test_service_links_disabled():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["template"]["spec"]["enableServiceLinks"] is False


def test_pod_runs_as_nobody_with_dropped_caps():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    pod = spec["spec"]["template"]["spec"]
    assert pod["securityContext"]["runAsUser"] == 65534
    assert pod["securityContext"]["runAsNonRoot"] is True
    container = pod["containers"][0]
    assert container["securityContext"]["readOnlyRootFilesystem"] is True
    assert container["securityContext"]["allowPrivilegeEscalation"] is False
    assert container["securityContext"]["capabilities"]["drop"] == ["ALL"]


def test_resource_limits_applied():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    container = spec["spec"]["template"]["spec"]["containers"][0]
    assert container["resources"]["limits"]["cpu"] == "2"
    assert container["resources"]["limits"]["memory"] == "2Gi"
    assert container["resources"]["limits"]["ephemeral-storage"] == "256Mi"


def test_active_deadline_seconds_set():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["activeDeadlineSeconds"] == 300
    assert spec["spec"]["backoffLimit"] == 0
    assert spec["spec"]["ttlSecondsAfterFinished"] == 30


def test_labels_include_user_and_execution():
    spec = build_job_spec(
        execution_id="exec-id-123", user_id="user-id-456", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    labels = spec["spec"]["template"]["metadata"]["labels"]
    assert labels["app.kubernetes.io/component"] == "sandbox"
    assert labels["sandbox.user-id"] == "user-id-456"
    assert labels["sandbox.execution-id"] == "exec-id-123"


def test_user_supplied_env_passed_through():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={"OPENAI_API_KEY": "sk-user-supplied", "WEIRD_VAR": "hello"},
        namespace="ns",
    )
    env = spec["spec"]["template"]["spec"]["containers"][0]["env"]
    by_name = {e["name"]: e["value"] for e in env}
    assert by_name["OPENAI_API_KEY"] == "sk-user-supplied"
    assert by_name["WEIRD_VAR"] == "hello"


def test_volumes_are_tmpfs_emptydirs():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    vols = {v["name"]: v for v in spec["spec"]["template"]["spec"]["volumes"]}
    for name in ("tmp", "work"):
        assert vols[name]["emptyDir"]["medium"] == "Memory"
        assert vols[name]["emptyDir"]["sizeLimit"] == "256Mi"
