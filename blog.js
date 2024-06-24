var Post = {};
var PostModel = {};

var Blog = {};
var BlogModel = {};

(async function () {
  "use strict";

  // Poor man's dependency tree
  // (just so everybody knows what I expect to use in here)
  var XTZ = window.XTZ;
  var $ = window.$;
  //var $$ = window.$$;
  var localStorage = window.localStorage;

  function _localStorageGetIds(prefix, suffix) {
    var i;
    var key;
    var ids = [];
    for (i = 0; i < localStorage.length; i += 1) {
      key = localStorage.key(i);
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      if (suffix && !key.endsWith(suffix)) {
        continue;
      }
      ids.push(key.slice(prefix.length).slice(0, -1 * suffix.length));
    }
    return ids;
  }

  function _localStorageGetAll(prefix) {
    var i;
    var key;
    var items = [];
    for (i = 0; i < localStorage.length; i += 1) {
      key = localStorage.key(i);
      if (!key.startsWith(prefix)) {
        continue;
      }
      items.push(JSON.parse(localStorage.getItem(key)));
    }
    return items;
  }

  Blog.serialize = function (ev) {
    ev.stopPropagation();
    ev.preventDefault();

    var $form = ev.target.closest("form");
    var repo = $('input[name="repo"]', $form).value;
    var gitbranch = $('input[name="gitbranch"]', $form).value;
    var githost = $('select[name="githost"]', $form).value;
    var blog = $('select[name="blog"]', $form).value;

    var dirty = false;
    try {
      new URL(repo); // jshint ignore:line
    } catch (e) {
      // ignore
      // dirty, don't save
      dirty = true;
    }

    if (dirty || !gitbranch) {
      Post.serialize(ev);
      return;
    }

    var parts = BlogModel._splitRepoBranch(repo, gitbranch);
    // TODO doesn't quite feel right
    $('input[name="gitbranch"]', $form).value = parts.gitbranch;
    if (repo.toLowerCase().startsWith("https://github.com/")) {
      githost = "github";
      $('select[name="githost"]', $form).value = githost;
    }
    $('input[name="repo"]', $form).value = parts.repo;

    BlogModel.save({
      repo: parts.repo,
      gitbranch: parts.gitbranch,
      githost: githost,
      blog: blog, // system (ex: Hugo)
    });
    Blog._renderRepoTypeaheads();
    Post.serialize(ev);
  };

  Blog._renderRepoTypeaheads = function () {
    $("#-repos").innerHTML = BlogModel.all().map(function (blog) {
      var id = blog.repo;
      if (blog.gitbranch) {
        id += "#" + blog.gitbranch;
      }
      return Blog._typeaheadTmpl.replace(/{{\s*id\s*}}/, id);
    });
  };

  /**
   *
   * Post is the View
   *
   */
  // Hit the New Draft button
  Post.create = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    // delete old untitled drafts
    PostModel.ids().forEach(function (id) {
      let post = PostModel.get(id);
      if (!post.title) {
        PostModel.delete(post.uuid);
      }
    });
    // create new untitled draft
    Post._deserialize(PostModel.create().uuid);
    Post._renderRows();
  };

  // Hit the save button (actually every key is the save button)
  Post.serialize = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    Post._update(PostModel._current);
  };

  // From form inputs to Model
  Post._serialize = function (post) {
    // TODO debounce with max time

    // TODO refactor
    post._gitbranch = $('input[name="gitbranch"]').value || "main";
    post._repo = ($('input[name="repo"]').value || "").replace(/\/+$/, "");
    post.blog_id = post._repo + "#" + post._gitbranch;
    //post.title = $('input[name="title"]').value;
    // 2021-07-01T13:59:59 => 2021-07-01T13:59:59-0600
    /*
    post.created = XTZ.toUTC(
      $('input[name="created"]').value,
      timezone
    ).toISOString();
    */

    var text = $('textarea[name="content"]').value.trim();
    var inputDescription = $('textarea[name="description"]').value;
    post.title = PostModel._parseTitle(text);
    if (!post.title) {
      console.log("remove (or just skip saving) empty doc");
      PostModel.delete(post.uuid);
      return;
    }

    // skip the first line of text (which was the title)
    var lines = text.split(/[\r\n]/g);

    post.content = lines.slice(1).join("\n").trim();
    // without Title
    lines = post.content.split(/[\r\n]/g);
    if (lines[0].startsWith(">")) {
      // new way
      post.description = lines[0].slice(1).trim();
      // don't trim this time (i.e. bad code block)
      // TODO check that it starts with alpha - not ``` or - or [link](./), for example
      post.content = lines
        .slice(1)
        .join("\n")
        .replace(/^[\n\r]+/, "");
    } else {
      // old way (TODO remove)
      if (inputDescription && post.description) {
        if (!post._dirtyDescription) {
          post._dirtyDescription = post.description !== inputDescription;
        }
      } else {
        post._dirtyDescription = false;
      }
      if (!post._dirtyDescription) {
        post.description = PostModel._parseDescription(post);
      } else {
        post.description = inputDescription;
      }
    }
    $('textarea[name="description"]').value = post.description;

    post = PostModel.normalize(post);
    post.updated = XTZ.toTimeZone(new Date(), post.timezone).toISOString();

    PostModel.save(post);
  };

  Post.patch = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    // Example:
    // If the description is empty, let the user have a chance
    // to fill in the blank (despite the fact that we set the
    // default value and just skip showing it)
    if (!ev.target.value) {
      PostModel._current[ev.target.name] = "";
      Post._serialize(PostModel._current);
      return;
    }

    Post._update(PostModel._current);
  };
  Post._update = function (post) {
    Post._serialize(post);
    let synced = post.sync_version === post.updated;
    // TODO fails to update under certain conditions
    if (
      post._previous.title !== post.title ||
      post._previous._synced !== synced
    ) {
      var cell = $('input[name="uuid"][value="' + post.uuid + '"]');
      var row = cell.closest("tr");
      row.outerHTML = Post._renderRow(post);
      post._previous.title = post.title;
      post._previous._synced = synced;
    }
    Post._rawPreview(post);
  };

  // From Model to form inputs
  Post.deserialize = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    var parent = ev.target.closest(".js-row");
    var uuid = $('input[name="uuid"]', parent).value;
    localStorage.setItem("current", uuid);
    // TODO maybe current should have a more precise name, such as currentPost
    PostModel._current = Post._deserialize(uuid);
  };
  Post._deserialize = function (uuid) {
    var post = PostModel.getOrCreate(uuid);
    var blog = BlogModel.getByPost(post) || {
      // deprecate
      repo: post._repo,
      githost: post._githost,
      gitbranch: post._gitbranch,
      blog: post._blog,
    };
    if (blog.githost) {
      $('select[name="githost"]').value = blog.githost;
    }
    if (blog.gitbranch) {
      $('input[name="gitbranch"]').value = blog.gitbranch;
    }
    if (blog.blog) {
      $('select[name="blog"]').value = blog.blog;
    }
    $('input[name="repo"]').value = blog.repo;

    //$('input[name="title"]').value = post.title;
    //$('input[name="created"]').value = PostModel._toInputDatetimeLocal(post.created);
    let title = (post.title || "").trim() || "Untitled";
    let emptyContent = "Fascinating Markdown content goes here...";
    let emptyDesc = "Meta-description summary goes here";
    let desc = (post.description || "").trim() || emptyDesc;
    let content = (post.content || "").trim() || emptyContent;
    if (desc.trim() === emptyContent) {
      desc = emptyDesc;
    }
    // TODO what about when desc.length matches content[0..desc.length]
    $('textarea[name="content"]').value = `# ${title}\n\n`;
    $('textarea[name="content"]').value += `> ${desc}\n\n`;
    $('textarea[name="content"]').value += `${content}\n`;
    $('textarea[name="description"]').value = desc;
    $(".js-undelete").hidden = true;

    Post._rawPreview(post);
    return post;
  };

  Post._renderRows = function () {
    var uuids = PostModel.ids();
    if (!uuids.length) {
      // Create first post ever on first ever page load
      // (or after literally everything is deleted)
      Post._deserialize(PostModel.create().uuid);
      uuids = PostModel.ids();
    }

    var items = uuids
      .map(PostModel.getOrCreate)
      .sort(function (a, b) {
        return new Date(a.updated).valueOf() - new Date(b.updated).valueOf();
      })
      .map(Post._renderRow);
    if (!items.length) {
      items.push(
        Post._rowTmpl
          .replace(/ hidden/g, "")
          .replace("{{title}}", "<i>Untitled</i>")
          .replace("{{uuid}}", "")
          .replace(
            "{{created}}",
            "🗓" +
              PostModel._toInputDatetimeLocal(new Date()).replace(/T/g, " ⏰")
          )
          .replace(
            "{{updated}}",
            "🗓" +
              PostModel._toInputDatetimeLocal(new Date()).replace(/T/g, " ⏰")
          )
      );
    }
    $(".js-items").innerHTML = items.join("\n");
  };

  Post._renderRow = function (post) {
    let needsUpdate = "";
    if (post.sync_version && post.sync_version !== post.updated) {
      needsUpdate = "⚠️ 🔄<br>";
    }
    let title = post.title.slice(0, 50).replace(/</g, "&lt;");
    if (!title || "Untitled" === title) {
      title = "<i>Untitled</i>";
    }
    var tmpl = Post._rowTmpl
      .replace(/ hidden/g, "")
      .replace("{{title}}", needsUpdate + title)
      .replace("{{uuid}}", post.uuid)
      .replace(
        "{{created}}",
        "🗓" +
          PostModel._toInputDatetimeLocal(post.created).replace(/T/g, "<br>⏰")
      )
      .replace(
        "{{updated}}",
        "🗓" +
          PostModel._toInputDatetimeLocal(post.updated).replace(/T/g, "<br>⏰")
      );
    return tmpl;
  };

  Post.delete = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    var q = "Are you sure you want to permanently delete this draft?";

    var parent = ev.target.closest(".js-row");
    var uuid = $('input[name="uuid"]', parent).value;

    if (!window.confirm(q)) {
      return;
    }

    if (!$(".js-undelete").hidden) {
      // if we're deleting multiple things, we don't want to re-save on delete
      Post.serialize(ev);
    }
    PostModel.delete(uuid);
    if (uuid === PostModel._current.uuid) {
      // load as a failsafe, just in case
      localStorage.removeItem("current", uuid);
      localStorage.setItem("current", PostModel.ids()[0]);
    } else {
      PostModel._current = Post._deserialize(uuid);
    }

    Post._renderRows();
    $(".js-undelete").hidden = false;
  };

  Post.undelete = function (ev) {
    ev.preventDefault();
    ev.stopPropagation();

    Post._update(PostModel._current);
    $(".js-undelete").hidden = true;
    Post._renderRows();
  };

  Post._rawPreview = function (post) {
    post = Post._gitNewFilePreview(post);
    post = Post._liveFormPreview(post);
  };
  // TODO PostModel
  Post._systems = {
    /*
     * Example:
      ---
      description: "Change ME to a good search engine-friendly description"
      ogimage: 'https://...'
      player: 'https://www.youtube.com/embed/XXXXXXXX?rel=0'
      youtube: XXXXXXXX
      categories:
        - Videography
      permalink: /articles/CHANGE-ME-SLUG/
      ---
     */
    desi: {
      pathname: "/posts",
      frontmatter: [
        "---",
        'title: "{{title}}"',
        'description: "{{description}}"',
        'timezone: "{{timezone}}"',
        'date: "{{created}}"',
        'updated: "{{updated}}"',
        "uuid: {{uuid}}",
        "categories:",
        "  - Web Development",
        "permalink: /articles/{{slug}}/",
        "---",
      ],
    },
    hugo: {
      pathname: "/content/blog",
      frontmatter: [
        "---",
        'title: "{{title}}"',
        'description: "{{description}}"',
        'date: "{{created}}"',
        'timezone: "{{timezone}}"',
        //'lastmod: "{{updated}}"', // GitInfo handles this
        //"uuid: {{uuid}}",
        'utterances_term: "{{title}}"',
        "categories: []",
        //"  - Web Development",
        "---",
      ],
    },
    bash: {
      pathname: "/articles",
      frontmatter: [
        // BashBlog has no frontmatter
        "{{title}}",
        '<meta name="description" content="{{description}}" />',
      ],
    },
    zola: {
      pathname: "/content",
      // RFC3339
      date: "iso",
      frontmatter: [
        // Zola uses TOML frontmatter
        "+++",
        "title = {{title}}",
        "description = {{description}}",
        "date = {{created}}",
        "updated = {{updated}}",
        "draft = false",
        "slug = {{slug}}",
        "+++",
      ],
    },
  };
  // TODO auto-upgrade the oldies
  Post._systems.eon = Post._systems.hugo;
  Post._gitNewFilePreview = function (post) {
    var blog = BlogModel.getByPost(post) || {
      // deprecate
      repo: post._repo,
      githost: post._githost,
      gitbranch: post._gitbranch,
      blog: post._blog,
    };
    post.slug = PostModel._toSlug(post.title);
    post._filename = post.slug + ".md";
    post._template = (
      Post._systems[blog.blog] || Post._systems.hugo
    ).frontmatter.join("\n");

    // TODO Post._renderFrontmatter
    var created = Post._formatFrontmatter(
      "created",
      post.created,
      post._system
    );
    var updated = Post._formatFrontmatter(
      "updated",
      post.updated,
      post._system
    );
    post._frontMatter = post._template
      // TODO loop to make look nicer?
      // ['title', 'timezone', 'created', 'updated', ... ]
      // str = str.replace(new RegExp('{{'+key+'}}', 'g'), val)
      // str = str.replace(new RegExp('"{{'+key+'}}"', 'g'), val)
      .replace(/"{{title}}"/g, JSON.stringify(post.title))
      .replace(/{{title}}/g, post.title)
      .replace(/"{{description}}"/g, JSON.stringify(post.description))
      .replace(/{{description}}/g, post.description)
      .replace(/"{{timezone}}"/g, JSON.stringify(post.timezone))
      .replace(/{{timezone}}/g, post.timezone)
      .replace(/"{{created}}"/g, JSON.stringify(created))
      .replace(/{{created}}/g, created)
      .replace(/"{{updated}}"/g, JSON.stringify(updated))
      .replace(/{{updated}}/g, updated)
      .replace(/"{{uuid}}"/g, JSON.stringify(post.uuid))
      .replace(/{{uuid}}/g, post.uuid)
      .replace(/"{{slug}}"/g, JSON.stringify(post.slug))
      .replace(/{{slug}}/g, post.slug);

    if (post._frontMatter.trim()) {
      post._filestr = post._frontMatter + "\n\n" + post.content;
    } else {
      post._filestr = post.content;
    }

    Post._addHref(post);

    return post;
  };
  Post._formatFrontmatter = function (_key, val, system) {
    // 2021-07-01T13:59:59-0600
    // => 2021-07-01 1:59:59 pm
    if ("Zola" === system) {
      // TODO make this a property of the system, like 'pathname'
      return val;
    }
    var parts = val.split("T");
    var date = parts[0];
    var time = parts[1];
    var times = time.replace(/([-+]\d{4}|Z)$/g, "").split(":");
    var hour = parseInt(times[0], 10) || 0;
    var meridian = "am";
    if (hour >= 12) {
      hour -= 12;
      meridian = "pm";
      times[0] = hour;
    }
    times[0] = hour;
    times[2] = "00";
    // 2021-07-01 + ' ' + 1:59:59 + ' ' +  pm
    return date + " " + times.join(":") + " " + meridian;
  };
  Post._addHref = function (post) {
    var blog = BlogModel.getByPost(post) || {
      repo: post._repo,
      githost: post._githost,
      gitbranch: post._gitbranch,
      blog: post._blog,
    };
    var pathname = (Post._systems[blog.blog] || Post._systems.hugo).pathname;
    if (!Post._systems[blog.blog]) {
      console.debug(
        "Warning: blog system not specified or unsupported, assuming hugo",
        blog.blog
      );
    }
    pathname = encodeURI(pathname);

    // construct href
    var href = "";
    var content = encodeURIComponent(post._filestr);
    switch (blog.githost) {
      case "gitea":
        href =
          "/_new/" +
          blog.gitbranch +
          "?filename=" +
          pathname +
          "/" +
          post.slug +
          ".md&value=" +
          content;
        break;
      case "github":
      /* falls through */
      case "gitlab":
      /* falls through */
      default:
        href =
          "/new/" +
          blog.gitbranch +
          "?filename=" +
          pathname +
          "/" +
          post.slug +
          ".md&value=" +
          content;
    }

    // issue warnings if needed
    switch (blog.githost) {
      case "gitea":
        break;
      case "github":
        break;
      case "gitlab":
        window.alert(
          "GitLab doesn't have query param support yet.\n\n" +
            "See https://gitlab.com/gitlab-org/gitlab/-/issues/337038"
        );
        break;
      default:
        // TODO log error
        console.debug(
          "Warning: blog.githost was not specified or unsupported, assuming github",
          blog.githost
        );
    }

    post._href = post._repo + href;

    return post;
  };
  Post._liveFormPreview = function (post) {
    if (post._filename && post.content) {
      $(".js-preview-container").hidden = false;
      $(".js-filename").innerText = post._filename;
      $(".js-preview").innerText = post._filestr;
    } else {
      $(".js-preview-container").hidden = true;
    }

    $('textarea[name="description"]').value = post.description;
    $(".js-description-length").innerText = post.description.length;
    // TODO put colors in variables
    if (post.description.length > 155) {
      $(".js-description-length").style.color = "#F60208";
    } else if (post.description.length > 125) {
      $(".js-description-length").style.color = "#FD9D19";
    } else {
      $(".js-description-length").style.removeProperty("color");
    }

    $("span.js-githost").innerText = $(
      'select[name="githost"] option:checked'
    ).innerText.split(" ")[0];
    // ex: https://github.com/beyondcodebootcamp/beyondcodebootcamp.com/

    $("a.js-commit-url").href = post._href;

    $("code.js-raw-url").innerText = $("a.js-commit-url").href;
    return post;
  };

  /**
   *
   * Post is the View
   *
   */

  // TODO JSDoc
  // https://gist.github.com/NickKelly1/bc372e5993d7b8399d6157d82aea790e
  // https://gist.github.com/wmerfalen/73b2ad08324d839e3fe23dac7139b88a

  /**
   * @typedef {{
   *  title: string;
   *  slug: string;
   *  description: string;
   *  date: Date;
   *  lastmod: Date;
   * }} BlissPost
   *
   */

  /**
   * @returns {BlissPost}
   */
  PostModel.create = function () {
    PostModel._current = PostModel.getOrCreate();
    localStorage.setItem("current", PostModel._current.uuid);
    PostModel.save(PostModel._current);
    return PostModel._current;
  };

  PostModel.normalize = function (post) {
    if (!post.uuid) {
      post.uuid = PostModel._uuid();
    }
    if (!post.title) {
      // ignore
    }
    if (!post.description) {
      // ignore
    }
    if (!post.content) {
      // ignore
    }

    if (!post.slug) {
      post.slug = PostModel._toSlug(post.title);
    }

    if (!post.timezone) {
      post.timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    let isoNow;
    if (!post.created || !post.updated) {
      isoNow = XTZ.toTimeZone(new Date(), post.timezone).toISOString();
      if (!post.created) {
        post.created = post.updated || isoNow;
      }
      if (!post.updated) {
        post.updated = isoNow;
      }
    }
    return post;
  };

  /**
   * @param {string} uuid
   * @returns {BlissPost}
   */
  PostModel.getOrCreate = function (uuid) {
    var post = PostModel.get(uuid) || { content: "" };
    post.uuid = uuid;

    if (!post.description) {
      post.description = PostModel._parseDescription(post);
    }
    if (!post.title) {
      post.title = localStorage.getItem(post.uuid + ".title") || "";
    }

    // Meta / Normalize
    post = PostModel.normalize(post);

    // TODO is there a better way to handle this?
    post._previous = {
      title: post.title,
      _synced: post.sync_version === post.updated,
    };

    // Blog
    // TODO post.blog_id
    // TODO BlogsModel.get(post.blog_id)
    if (!post._repo) {
      post._repo = "";
    }
    if (!post._gitbranch) {
      post._gitbranch = "main";
    }

    return post;
  };

  /**
   * @param {string} uuid
   * @returns {BlissPost?}
   */
  PostModel.get = function (uuid) {
    // Meta
    let json = localStorage.getItem("post." + uuid + ".meta");
    if (!json) {
      return null;
    }
    let post = JSON.parse(json);

    // Content
    post.content = localStorage.getItem("post." + post.uuid + ".data") || "";
    return post;
  };

  PostModel.ids = function () {
    return _localStorageGetIds("post.", ".meta");
  };

  PostModel.save = function (post) {
    // TODO how to not be leaky about PostModel / SyncModel
    //return PostModel._save(post, "", xattrs = ['sync_id']);
    return PostModel._save(post, "");
  };

  PostModel.saveVersion = function (post) {
    let d = new Date(post.updated || "1970-01-01T00:00:00.000Z");
    return PostModel._save(post, ":version:" + d.toISOString());
  };

  PostModel._save = function (post, version) {
    localStorage.setItem(
      "post." + post.uuid + ".meta" + version,
      JSON.stringify({
        // TODO draft: true|false,
        // TODO unlisted: true|false,
        title: post.title,
        description: post.description,
        uuid: post.uuid,
        slug: post.slug,
        created: post.created,
        updated: post.updated,
        timezone: post.timezone,

        // TODO iterate over localStorage to upgrade
        blog_id: post._repo + "#" + post._gitbranch,
        _blog: post._blog,
        _githost: post._githost,
        _gitbranch: post._gitbranch,
        _repo: post._repo,

        // for syncing
        sync_id: post.sync_id,
        sync_version: post.sync_version,
      })
    );
    localStorage.setItem("post." + post.uuid + ".data" + version, post.content);
    return post;
  };

  PostModel.delete = function (uuid) {
    localStorage.removeItem(`post.${uuid}.meta`);
    localStorage.removeItem(`post.${uuid}.data`);
  };

  PostModel._getRandomValues = function (arr) {
    var len = arr.byteLength || arr.length;
    var i;
    for (i = 0; i < len; i += 1) {
      arr[i] = Math.round(Math.random() * 255);
    }
    return arr;
  };

  PostModel._uuid = function () {
    var rnd = new Uint8Array(18);
    PostModel._getRandomValues(rnd);
    var hex = [].slice
      .apply(rnd)
      .map(function (ch) {
        return ch.toString(16);
      })
      .join("")
      .split("");
    hex[8] = "-";
    hex[13] = "-";
    hex[14] = "4";
    hex[18] = "-";
    hex[19] = (8 + (parseInt(hex[19], 16) % 4)).toString(16);
    hex[23] = "-";
    return hex.join("");
  };

  PostModel._uuid_sep = " ";

  PostModel._toSlug = function (str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-/g, "")
      .replace(/-$/g, "")
      .trim();
  };

  PostModel._toInputDatetimeLocal = function (
    d = new Date(),
    tz = new Intl.DateTimeFormat().resolvedOptions().timeZone
  ) {
    // TODO
    // It's quite reasonable that a person may create the post
    // in an Eastern state on New York time and later edit the
    // same post in a Western state on Mountain Time.
    //
    // How to we prevent the time from being shifted accidentally?
    //
    // ditto for updated at
    /*
  if ("string" === typeof d) {
    return d.replace(/([+-]\d{4}|Z)$/, '');
  }
  */
    d = new Date(d);
    return (
      [
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-") +
      "T" +
      [
        String(d.getHours()).padStart(2, "0"),
        String(d.getMinutes()).padStart(2, "0"),
      ].join(":")
    );
  };

  PostModel._parseTitle = function (text) {
    // split on newlines and grab the first as title
    var title = text
      .trim()
      .split(/[\r\n]/g)[0]
      .trim();
    // "\n\n    #    #1 Title #2 Article \n\n\n blah blah blah \n blah"
    if (title.trim().startsWith("#")) {
      title = title.replace(/^#*\s*/, "");
    }
    return title;
  };

  PostModel._parseDescription = function (post) {
    // 152 is the max recommended length for meta description
    const MAX_META_DESC_LEN = 152;

    // Note: content has had the Title stripped by now
    // (and this won't even be called if the description was indicated with '>')
    var desc =
      post.content.split(/[\r\n]/g).filter(function (line) {
        // filter spaces, newlines, etc
        return line.trim();
      })[0] || "";
    desc = desc.trim().slice(0, MAX_META_DESC_LEN);
    if (MAX_META_DESC_LEN === desc.length) {
      desc = desc.slice(0, desc.lastIndexOf(" "));
      desc += "...";
    }
    return desc;
  };

  /**
   *
   * Post is the View
   *
   */
  BlogModel.getByPost = function (post) {
    var id = post.blog_id;
    // deprecate
    if (post._repo) {
      id = post._repo.replace(/\/$/, "") + "#" + (post._gitbranch || "main");
    }
    return BlogModel.get(id);
  };
  BlogModel.get = function (id) {
    // repo+#+branch
    var json = localStorage.getItem("blog." + id);
    if (!json) {
      return null;
    }

    return JSON.parse(json);
  };

  BlogModel.save = function (blogObj) {
    // blog.https://github.com/org/repo#main
    var key = "blog." + blogObj.repo + "#" + blogObj.gitbranch;
    localStorage.setItem(
      key,
      JSON.stringify({
        repo: blogObj.repo,
        gitbranch: blogObj.gitbranch,
        githost: blogObj.githost,
        blog: blogObj.blog, // system (ex: Hugo)
      })
    );
  };

  BlogModel.all = function (blogObj) {
    return _localStorageGetAll("blog.");
  };

  BlogModel._splitRepoBranch = function (repo, _branch) {
    // TODO trim trailing /s
    var parts = repo.split("#");
    repo = parts[0].replace(/\/+$/, "");
    var branch = parts[1] || "";
    if (!branch || "undefined" === branch) {
      branch = _branch;
    }
    return { repo: repo, gitbranch: branch };
  };

  /*
   * inits
   *
   */
  Blog._init = function () {
    Blog._typeaheadTmpl = $("#-repos").innerHTML;
    Blog._renderRepoTypeaheads();
    // hotfix
    BlogModel.all().forEach(function (blog) {
      // https://github.com/org/repo (no #branchname)
      var parts = BlogModel._splitRepoBranch(blog.repo, blog.gitbranch);
      blog.repo = parts.repo;
      blog.gitbranch = parts.gitbranch;
      if (!blog.gitbranch) {
        // TODO delete
      }
      BlogModel.save(blog);
    });
  };

  Post._init = function () {
    // build template strings
    Post._rowTmpl = $(".js-row").outerHTML;
    $(".js-row").remove();

    // show all posts
    Post._renderRows();

    // load most recent draft
    Post._deserialize(PostModel._current.uuid);
  };

  PostModel._init = function () {
    // TODO XXX XXX
    PostModel._current = PostModel.getOrCreate(localStorage.getItem("current"));
  };
})();
