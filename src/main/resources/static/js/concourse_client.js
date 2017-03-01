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
                    var newestFailureTime = 0;
                    var newestRunningTime = 0;
                    var newestSuccessTime = 0;
                    for (var i = 0; i < jobs.length; i++) {
                        var job = jobs[i];

                        var finishedBuild = job["finished_build"];
                        if (finishedBuild != null) {
                            if (finishedBuild.status === "failed") {
                                newestFailureTime = Math.max(newestFailureTime, finishedBuild["end_time"]);
                            } else if (finishedBuild.status === "succeeded") {
                                newestSuccessTime = Math.max(newestSuccessTime, finishedBuild["end_time"]);
                            }
                        }

                        var nextBuild = job["next_build"];
                        if (nextBuild != null) {
                            newestRunningTime = Math.max(newestRunningTime, nextBuild["start_time"]);
                        }
                    }
                    appendResult({
                        "name": p.name,
                        "jobs": jobs,
                        "newestFailureTime": newestFailureTime,
                        "newestRunningTime": newestRunningTime,
                        "newestSuccessTime": newestSuccessTime
                    });
                });
            }
        });
    }

    this.getBuildInfo = function(pipelineName, jobName, latestKnownBuild, sinceDate, onSuccess) {
        let buildsUrl = "/api/v1/teams/main/pipelines/" + encodeURIComponent(pipelineName) + "/jobs/" + encodeURIComponent(jobName) + "/builds";
        let cachedBuildsJson = window.localStorage.getItem(buildsUrl);
        if (cachedBuildsJson != null) {
            let cachedBuildInfo = JSON.parse(cachedBuildsJson);
            if (latestKnownBuild == cachedBuildInfo.lastBuildNumber && sinceDate == cachedBuildInfo.sinceDate) {

                // this isn't recommended, but it's easier than the alternatives.
                // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/proto
                cachedBuildInfo.__proto__ = BuildInfo.prototype;

                onSuccess(cachedBuildInfo);
                return;
            }
        }
        xhrGet(buildsUrl, function(builds) {
            let statuses = {};
            for (var i = 0; i < builds.length; i++) {
                let build = builds[i];
                if (build.end_time == null) {
                    continue;
                }
                if (build.end_time < sinceDate) {
                    break;
                }
                if (statuses.hasOwnProperty(build.status)) {
                    statuses[build.status]++;
                } else {
                    statuses[build.status] = 1;
                }
            }
            let buildInfo = new BuildInfo(statuses, builds[0].name, sinceDate);
            window.localStorage.setItem(buildsUrl, JSON.stringify(buildInfo));
            onSuccess(buildInfo);
        });
    }
}

function BuildInfo(statuses, lastBuildNumber, sinceDate) {
    this.statuses = statuses;
    this.lastBuildNumber = lastBuildNumber;
    this.sinceDate = sinceDate;

}
BuildInfo.prototype.statusCount = function(status) {
    return this.statuses[status] == null ? 0 : this.statuses[status];
}
