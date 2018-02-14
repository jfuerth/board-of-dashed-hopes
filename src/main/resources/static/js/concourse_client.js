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
                    var newestSuccessJobTimes = {};

                    for (var i = 0; i < jobs.length; i++) {
                        var job = jobs[i];

                        var finishedBuild = job["finished_build"];
                        if (finishedBuild != null) {
                            if (finishedBuild.status === "failed" || finishedBuild.status === "errored") {
                                newestFailureTime = Math.max(newestFailureTime, finishedBuild["end_time"]);
                            } else if (finishedBuild.status === "succeeded") {
                                newestSuccessTime = Math.max(newestSuccessTime, finishedBuild["end_time"]);
                                newestSuccessJobTimes[job["name"]] = finishedBuild["end_time"];
                            }
                        }

                        var nextBuild = job["next_build"];
                        if (nextBuild != null) {
                            newestRunningTime = Math.max(newestRunningTime, nextBuild["start_time"]);
                        }
                    }

                    appendResult({
                        "name": p.name,
                        "jobs": self.orderedJobs(jobs),
                        "newestFailureTime": newestFailureTime,
                        "newestRunningTime": newestRunningTime,
                        "newestSuccessTime": newestSuccessTime,
                        "newestSuccessJobTimes": newestSuccessJobTimes
                    });
                });
            }
        });
    }

    this.orderedJobs = function(jobs) {
        var nameDepths = {};
        var parentNames = {};
        var toPlace = jobs;
        for (var level = 0; toPlace.length > 0; level++) {
            var keys = Object.keys(nameDepths);
            var placeNext = [];
            toPlace.forEach(function(job) {
                var passedNames = [];
                job["inputs"].forEach(function(input) {
                    if ("passed" in input) {
                        passedNames = passedNames.concat(input["passed"]);
                        input["passed"].forEach(function(name) {
                            parentNames[name] = 1;
                        });
                    }
                });

                var diff = passedNames.filter(function(passedName) { return keys.indexOf(passedName) < 0 });
                if (diff.length == 0) {
                    nameDepths[job["name"]] = level;
                } else {
                    placeNext.push(job);
                }
            });
            toPlace = placeNext;
        }

        var jobsByName = {};
        jobs.forEach(function(job) {
            jobsByName[job["name"]] = job;
        });

        var ordered = [];
        var noChildren = [];
        for (level = 0; Object.keys(nameDepths).length > 0; level++) {
            Object.keys(nameDepths).forEach(function(key) {
                if (nameDepths[key] == level) {
                    var job = jobsByName[key];
                    if (job["name"] in parentNames || level > 0) {
                        ordered.push(job);
                    } else {
                        noChildren.push(job);
                    }
                    delete nameDepths[key];
                }
            });
        }
        return ordered.concat(noChildren);
    }
}
