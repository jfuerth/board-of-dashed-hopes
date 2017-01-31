function ConcourseClient(base_url) {
    var self = this;

    /**
     * Client-supplied callback. Called when there is a likely authentication failure.
     *
     * @param reason an HTML string describing the auth failure.
     */
    this.onAuthError = null;

    function xhrGet(url, onSuccess) {
        xhrGetWithHeaders(url, {}, onSuccess);
    }

    function xhrGetWithHeaders(url, headers, onSuccess) {
        var xhr = new XMLHttpRequest();

        xhr.addEventListener("load", function(evt) {
            if (this.status == 401) {
                self.onAuthError("Authorization Error")
            }
            var responseJson = JSON.parse(this.responseText);
            onSuccess(responseJson);
        });
        xhr.addEventListener("error", function(evt) { console.log("Error in XHR", evt) });
        xhr.addEventListener("abort", function(evt) { console.log("XHR aborted", evt) });

        if (url.startsWith("/")) {
            url = base_url + url;
        }

        xhr.open("GET", url);

        for (var header in headers) {
            if (headers.hasOwnProperty(header)) {
                xhr.setRequestHeader(header, headers[header]);
            }
        }

        xhr.send();
    }

    this.auth = function(username, password, onSuccess) {
        var token = "Basic " + btoa(username + ":" + password);
        xhrGetWithHeaders("/api/v1/teams/main/auth/token", {"Authorization": token}, function(responseJson) {
            if (onSuccess != undefined) {
                onSuccess(responseJson);
            }
        });
    }

    this.getPipelines = function(onSuccess) {
        xhrGet("/api/v1/pipelines", function(pipelines) {
            if (pipelines.length == 0) {
                self.onAuthError("No pipelines found.")
                return;
            }

            pipelines = pipelines.filter(function(p) { return !p.paused; });

            var result = [];
            function appendResult(pipelineResult) {
                result.push(pipelineResult);
                if (result.length === pipelines.length) {
                    onSuccess(result);
                }
            }

            for (var i = 0; i < pipelines.length; i++) {
                let p = pipelines[i];
                if (p.paused) { continue; }

                xhrGet("/api/v1/teams/main/pipelines/" + encodeURIComponent(p.name) + "/jobs", function(jobs) {
                    var failingJobs = [];
                    var newestFailureTime = 0;
                    for (var i = 0; i < jobs.length; i++) {
                        var job = jobs[i];
                        var finishedBuild = job["finished_build"];
                        if (finishedBuild != null) {
                            if (finishedBuild.status === "failed") {
                                newestFailureTime = Math.max(newestFailureTime, finishedBuild["end_time"]);
                                failingJobs.push(job);
                            }
                        }
                    }
                    appendResult({
                        "name": p.name,
                        "newestFailureTime": newestFailureTime,
                        "failingJobs": failingJobs
                    });
                });
            }
        });
    }
}

var concourse = new ConcourseClient("/concourse");
